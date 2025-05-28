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
  /**
   * n8n dynamic option methods
   */
   methods = {
    loadOptions: {
      /**
       * Fetch Centreon monitoring servers for dropdown
       */
      async getMonitoringServers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
        const version = this.getNodeParameter('version', 0) as string;
        const baseUrl = creds.baseUrl.replace(/\/+$/, '');

        // auth
        const authResp = (await this.helpers.request({
          method: 'POST',
          uri: `${baseUrl}/api/${version}/login`,
          headers: { 'Content-Type': 'application/json' },
          body: { security: { credentials: { login: creds.username, password: creds.password } } },
          json: true,
          rejectUnauthorized: false,
        } as any)) as { security?: { token?: string } };

        const token = authResp.security?.token;
        if (!token) {
          throw new NodeOperationError(this.getNode(), 'Cannot authenticate to Centreon');
        }

        const serverResp = (await this.helpers.request({
          method: 'GET',
          uri: `${baseUrl}/api/${version}/configuration/monitoring-servers`,
          headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': token },
          json: true,
          rejectUnauthorized: false,
        } as any)) as { result?: Array<{ id: number; name: string }> };

        const servers = serverResp.result;
        if (!servers) {
          throw new NodeOperationError(this.getNode(), 'Invalid response from Centreon');
        }

        return servers.map((s) => ({ name: s.name, value: s.id }));
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
        options: [{ name: 'Host', value: 'host' }],
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
      {
        displayName: 'Name',
        name: 'name',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['add'] },
        },
        description: 'Nom de l’hôte à créer',
      },
      {
        displayName: 'Address',
        name: 'address',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['add'] },
        },
        description: 'Adresse IP de l’hôte',
      },
      {
        displayName: 'Monitoring Server Name or ID',
        name: 'monitoringServerId',
        type: 'options',
        required: true,
        typeOptions: {
	  loadOptionsMethod: 'getMonitoringServers', 
	},
        default: '',
        displayOptions: {
          show: { resource: ['host'], operation: ['add'] },
        },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
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

  /**
   * MAIN EXECUTION
   */
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
    const version = this.getNodeParameter('version', 0) as string;
    const ignoreSsl = this.getNodeParameter('advancedOptions.ignoreSsl', 0, false) as boolean;

    const token = await getAuthToken.call(this, creds, ignoreSsl, version);

    const items = this.getInputData();
    const returnData: IDataObject[] = [];

    for (let i = 0; i < items.length; i++) {
      const resource = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;
      let responseData: any;

      if (resource === 'host') {
        if (operation === 'list') {
          responseData = await centreonRequest.call(
            this,
            creds,
            token,
            'GET',
            '/monitoring/hosts',
            {},
            ignoreSsl,
            version,
          );
        } else if (operation === 'add') {
          const name = this.getNodeParameter('name', i) as string;
          const address = this.getNodeParameter('address', i) as string;
          const monitoringServerId = this.getNodeParameter('monitoringServerId', i) as number;
          responseData = await centreonRequest.call(
            this,
            creds,
            token,
            'POST',
            '/configuration/hosts',
            { name, alias: name, address, monitoringServerId },
            ignoreSsl,
            version,
          );
        }
      }

      if (responseData !== undefined) returnData.push(responseData as IDataObject);
    }

    const executionData = returnData.map((d) => ({ json: d })) as INodeExecutionData[];
    return this.prepareOutputData(executionData);
  }
}

/** Helper: auth */
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

/** Helper: generic request */
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
    headers: {
      'Content-Type': 'application/json',
      'X-AUTH-TOKEN': token,
    },
    body,
    json: true,
    rejectUnauthorized: !ignoreSsl,
  } as any);
}

