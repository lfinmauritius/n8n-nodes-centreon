// @ts-nocheck
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

// @ts-ignore TS2420: class intentionally implements ILoadOptionsFunctions without explicit members
export class Centreon implements INodeType, ILoadOptionsFunctions {
  // Allow dynamic option loading without implementing all ILoadOptionsFunctions
  [key: string]: any;
  
  description: INodeTypeDescription = {
    displayName: 'Centreon',
    name: 'centreon',
    icon: 'file:centreon.svg',
    group: ['transform'],
    version: 1,
    subtitle: '{{ $parameter.resource }}: {{ $parameter.operation }}',
    description: 'Interagir avec l’API Centreon Web (v2)',
    defaults: {
      name: 'Centreon',
    },
    inputs: ['main'] as NodeConnectionType[],
    outputs: ['main'] as NodeConnectionType[],
    credentials: [
      {
        name: 'centreonApi',
        required: true,
      },
    ],
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
        typeOptions: {
          loadOptionsMethod: 'getMonitoringServers',
        },
        required: true,
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

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentialsData = await this.getCredentials('centreonApi');
    const creds = credentialsData as unknown as ICentreonCreds;
    const version = this.getNodeParameter('version', 0) as string;
    const ignoreSsl = this.getNodeParameter('advancedOptions.ignoreSsl', 0) as boolean;

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

      if (responseData !== undefined) {
        returnData.push(responseData as IDataObject);
      }
    }

    const executionData = returnData.map(data => ({ json: data })) as INodeExecutionData[];
    return this.prepareOutputData(executionData);
  }

  /**
   * Load options to get available monitoring servers
   */
  async getMonitoringServers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    // Load credentials
    const credentialsData = await this.getCredentials('centreonApi');
    const creds = credentialsData as unknown as ICentreonCreds;
    const version = this.getNodeParameter('version', 0) as string;
    // Ensure baseUrl has no trailing slash
    const baseUrl = creds.baseUrl.replace(/\/+$/, '');
    // Debug: Loading monitoring servers URL
      console.log(`Loading monitoring servers from ${baseUrl}/api/${version}/configuration/monitoring-servers`);

    try {
      // Authenticate inline
      const authOptions = {
        method: 'POST',
        uri: `${baseUrl}/api/${version}/login`,
        headers: { 'Content-Type': 'application/json' },
        body: { security: { credentials: { login: creds.username, password: creds.password } } },
        json: true,
        rejectUnauthorized: false,
      };
      // Debug: Auth request options
      console.log('Auth request options:', authOptions);
      const authResponse = await this.helpers.request(authOptions as any) as { security?: { token?: string } };
      // Debug: Auth response
      console.log('Auth response:', authResponse);
      const token = authResponse.security?.token;
      if (!token) {
        throw new NodeOperationError(this.getNode(), 'No token returned during authentication');
      }

      // Fetch monitoring servers
      const serverOptions = {
        method: 'GET',
        uri: `${baseUrl}/api/${version}/configuration/monitoring-servers`,
        headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': token },
        json: true,
        rejectUnauthorized: false,
      };
      // Debug: Monitoring servers request options
      console.log('Monitoring servers request options:', serverOptions);
      const response = await this.helpers.request(serverOptions as any) as { result?: Array<{ id: number; name: string }> };
      // Debug: Monitoring servers response
      console.log('Monitoring servers response:', response);

      if (!response.result) {
        throw new NodeOperationError(this.getNode(), 'Invalid response format');
      }

      return response.result.map((srv) => ({ name: srv.name, value: srv.id }));
    } catch (error) {
      // Debug: Error in getMonitoringServers
      console.error('Error in getMonitoringServers:', error);
      // Rethrow as NodeOperationError for UI
      throw new NodeOperationError(this.getNode(), `Error fetching options from Centreon: ${(error as Error).message}`);
    }
  }
}

async function getAuthToken(
  this: IExecuteFunctions,
  creds: ICentreonCreds,
  ignoreSsl: boolean,
  version: string,
): Promise<string> {
  const options = {
    method: 'POST',
    uri: `${creds.baseUrl}/api/${version}/login`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      security: {
        credentials: { login: creds.username, password: creds.password },
      },
    },
    json: true,
    rejectUnauthorized: !ignoreSsl,
  };
  const response = (await this.helpers.request(options as any)) as { security?: { token?: string } };

  if (!response.security?.token) {
    throw new NodeOperationError(this.getNode(), 'Authentification Centreon échouée (pas de token)');
  }

  return response.security.token;
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
  const options = {
    method,
    uri: `${creds.baseUrl}/api/${version}${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      'X-AUTH-TOKEN': token,
    },
    body,
    json: true,
    rejectUnauthorized: !ignoreSsl,
  };
  return this.helpers.request(options as any);
}

