import {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeType,
  INodeTypeDescription,
  IDataObject,
  INodeExecutionData,
  INodePropertyOptions,
  NodeOperationError,
  NodeConnectionType,
} from 'n8n-workflow';
import { ICentreonCreds } from '../../credentials/CentreonApi.credentials';

export class Centreon implements INodeType {
  methods = {
    loadOptions: {
      /** Monitoring servers */
      async getMonitoringServers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return fetchFromCentreon.call(this, '/configuration/monitoring-servers');
      },
      /** Host templates */
      async getHostTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return fetchFromCentreon.call(this, '/configuration/hosts/templates');
      },
      /** Host groups */
      async getHostGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return fetchFromCentreon.call(this, '/configuration/hosts/groups');
      },
      /** Hosts (for services) */
      async getHosts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return fetchFromCentreon.call(this, '/configuration/hosts');
      },
      /** Service templates */
      async getServiceTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return fetchFromCentreon.call(this, '/configuration/services/templates');
      },
    },
  };

  description: INodeTypeDescription = {
    displayName: 'Centreon',
    name: 'centreon',
    icon: 'file:centreon.svg',
    group: ['transform'],
    version: 1,
    subtitle: '{{ $parameter.resource }}: {{ $parameter.operation }}',
    description: 'Interagir avec l’API Centreon Web (v2)',
    defaults: { name: 'Centreon' },
    inputs: ['main'] as NodeConnectionType[],
    outputs: ['main'] as NodeConnectionType[],
    credentials: [{ name: 'centreonApi', required: true }],
    properties: [
      {
        displayName: 'API Version',
        name: 'version',
        type: 'string',
        default: 'latest',
        description: 'Version de l’API (e.g., latest, v24.10)',
      },
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Host', value: 'host' },
          { name: 'Service', value: 'service' },
        ],
        default: 'host',
        description: 'Type de ressource Centreon',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'List', value: 'list' },
          { name: 'Add', value: 'add' },
        ],
        default: 'list',
        description: 'Opération à réaliser',
      },
      // ---- HOST: LIST ----
      {
        displayName: 'Host Name (Like Format)',
        name: 'filterName',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['host'], operation: ['list'] } },
        description: 'Regex to filter hosts by name',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 50,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { resource: ['host'], operation: ['list'] } },
        description: 'Max number of results to return',
      },
      // ---- HOST: ADD ----
      {
        displayName: 'Name',
        name: 'name',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['host'], operation: ['add'] } },
        description: 'Nom de l’hôte à créer',
      },
      {
        displayName: 'Address',
        name: 'address',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['host'], operation: ['add'] } },
        description: 'Adresse IP de l’hôte',
      },
      {
        displayName: 'Monitoring Server Name or ID',
        name: 'monitoringServerId',
        type: 'options',
        required: true,
        typeOptions: { loadOptionsMethod: 'getMonitoringServers' },
        default: '',
        displayOptions: { show: { resource: ['host'], operation: ['add'] } },
        description: 'Choose from the list, or specify an ID using an expression. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Templates Names or IDs',
        name: 'templates',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getHostTemplates' },
        required: true,
        default: [],
        displayOptions: { show: { resource: ['host'], operation: ['add'] } },
        description: 'Choose from the list, or specify IDs using an expression. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Hostgroups Names or IDs',
        name: 'hostgroups',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getHostGroups' },
        default: [],
        displayOptions: { show: { resource: ['host'], operation: ['add'] } },
        description: 'Choose from the list, or specify IDs using an expression. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      // ---- SERVICE: LIST ----
      {
        displayName: 'Service Name (Like Format)',
        name: 'filterName',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['service'], operation: ['list'] } },
        description: 'Regex to filter services by name',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 50,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { resource: ['service'], operation: ['list'] } },
        description: 'Max number of results to return',
      },
      // ---- SERVICE: ADD ----
      {
        displayName: 'Service Name',
        name: 'servicename',
        default: '',
        type: 'string',
        required: true,
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Nom du service à créer',
      },
      {
        displayName: 'Description',
        name: 'description',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Description du service',
      },
      {
        displayName: 'Host',
        name: 'hostId',
        type: 'options',
        default: '',
        typeOptions: { loadOptionsMethod: 'getHosts' },
        required: true,
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Hôte associé au service',
      },
      {
        displayName: 'Template(s) Names or IDs',
        name: 'templates',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getServiceTemplates' },
        default: [],
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Templates de service à appliquer. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      // ---- ADVANCED OPTIONS ----
      {
        displayName: 'Options Avancées',
        name: 'advancedOptions',
        type: 'collection',
        placeholder: 'Afficher Options Avancées',
        default: {},
        options: [
          {
            displayName: 'Ignore SSL Errors',
            name: 'ignoreSsl',
            type: 'boolean',
            default: false,
            description: 'Whether to ignore TLS certificate errors',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
    const version = this.getNodeParameter('version', 0) as string;
    const ignoreSsl = this.getNodeParameter('advancedOptions.ignoreSsl', 0, false) as boolean;
    const token = await getAuthToken.call(this, creds, ignoreSsl, version);

    const items = this.getInputData();
    const returnData: IDataObject[] = [];

    for (let i = 0; i < items.length; i++) {
      const resource  = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;
      let responseData: any;

      if (resource === 'host') {
        if (operation === 'list') {
          const filterName = this.getNodeParameter('filterName', i, '') as string;
          const limit      = this.getNodeParameter('limit', i, 50) as number;
          const params: string[] = [];
          if (filterName) {
            const searchObj = { $and: [{ 'host.name': { $lk: filterName } }] };
            params.push(`search=${encodeURIComponent(JSON.stringify(searchObj))}`);
          }
          if (limit) {
            params.push(`limit=${limit}`);
          }
          const qs = params.length ? `?${params.join('&')}` : '';
          responseData = await centreonRequest.call(
            this, creds, token, 'GET', `/monitoring/hosts${qs}`, {}, ignoreSsl, version,
          );
        } else if (operation === 'add') {
          const name               = this.getNodeParameter('name', i) as string;
          const address            = this.getNodeParameter('address', i) as string;
          const monitoringServerId = this.getNodeParameter('monitoringServerId', i) as number;
          const templates          = this.getNodeParameter('templates', i, []) as number[];
          const hostgroups         = this.getNodeParameter('hostgroups', i, []) as number[];
          responseData = await centreonRequest.call(
            this, creds, token, 'POST', '/configuration/hosts',
            { name, alias: name, address, monitoring_server_id: monitoringServerId, templates, groups: hostgroups },
            ignoreSsl, version,
          );
        }
      }
      else if (resource === 'service') {
        if (operation === 'list') {
          const filterName = this.getNodeParameter('filterName', i, '') as string;
          const limit      = this.getNodeParameter('limit', i, 50) as number;
          const params: string[] = [];
          if (filterName) {
            const searchObj = { $and: [{ 'service.name': { $lk: filterName } }] };
            params.push(`search=${encodeURIComponent(JSON.stringify(searchObj))}`);
          }
          if (limit) {
            params.push(`limit=${limit}`);
          }
          const qs = params.length ? `?${params.join('&')}` : '';
          responseData = await centreonRequest.call(
            this, creds, token, 'GET', `/monitoring/services${qs}`, {}, ignoreSsl, version,
          );
        } else if (operation === 'add') {
          const name      = this.getNodeParameter('servicename', i) as string;
          const desc      = this.getNodeParameter('description', i) as string;
          const hostId    = this.getNodeParameter('hostId', i) as number;
          const templates = this.getNodeParameter('templates', i, []) as number[];
          const body: IDataObject = { name, description: desc, host_id: hostId, templates };
          responseData = await centreonRequest.call(
            this, creds, token, 'POST', '/configuration/services', body, ignoreSsl, version,
          );
        }
      }

      if (responseData !== undefined) {
        returnData.push(responseData as IDataObject);
      }
    }

    const executionData = returnData.map((d) => ({ json: d })) as INodeExecutionData[];
    return this.prepareOutputData(executionData);
  }
}


/** Helper: auth + generic request */
async function fetchFromCentreon(
  this: ILoadOptionsFunctions,
  endpoint: string,
): Promise<INodePropertyOptions[]> {
  const creds   = (await this.getCredentials('centreonApi')) as ICentreonCreds;
  const version = this.getNodeParameter('version', 0) as string;
  const baseUrl = creds.baseUrl.replace(/\/+$/, '');

  const authResp = (await this.helpers.request({
    method: 'POST',
    uri: `${baseUrl}/api/${version}/login`,
    headers: { 'Content-Type': 'application/json' },
    body: { security: { credentials: { login: creds.username, password: creds.password } } },
    json: true,
    rejectUnauthorized: false,
  } as any)) as { security?: { token?: string } };

  const token = authResp.security?.token;
  if (!token) throw new NodeOperationError(this.getNode(), 'Cannot authenticate to Centreon');

  const resp = (await this.helpers.request({
    method: 'GET',
    uri: `${baseUrl}/api/${version}${endpoint}`,
    headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': token },
    json: true,
    rejectUnauthorized: false,
  } as any)) as { result?: Array<{ id: number; name: string }> };

  const list = resp.result;
  if (!list) throw new NodeOperationError(this.getNode(), 'Invalid response from Centreon');

  return list.map((e) => ({ name: e.name, value: e.id }));
}

async function getAuthToken(
  this: IExecuteFunctions,
  creds: ICentreonCreds,
  ignoreSsl: boolean,
  version: string,
): Promise<string> {
  const resp = (await this.helpers.request({
    method: 'POST',
    uri: `${creds.baseUrl.replace(/\/+$/, '')}/api/${version}/login`,
    headers: { 'Content-Type': 'application/json' },
    body: { security: { credentials: { login: creds.username, password: creds.password } } },
    json: true,
    rejectUnauthorized: !ignoreSsl,
  } as any)) as { security?: { token?: string } };

  if (!resp.security?.token) throw new NodeOperationError(this.getNode(), 'Authentication failed');
  return resp.security.token;
}

async function centreonRequest(
  this: IExecuteFunctions,
  creds: ICentreonCreds,
  token: string,
  method: string,
  endpoint: string,
  body: IDataObject,
  ignoreSsl: boolean,
  version: string,
): Promise<any> {
  return this.helpers.request({
    method,
    uri: `${creds.baseUrl.replace(/\/+$/, '')}/api/${version}${endpoint}`,
    headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': token },
    body,
    json: true,
    rejectUnauthorized: !ignoreSsl,
  } as any);
}

