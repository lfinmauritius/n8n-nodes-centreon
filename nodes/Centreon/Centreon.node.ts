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
  NodeApiError,
} from 'n8n-workflow';
import { ICentreonCreds } from '../../credentials/CentreonApi.credentials';

// Helper Types
interface CentreonRequestOptions {
  method: string;
  endpoint: string;
  body?: IDataObject;
  params?: IDataObject;
}

interface MacroItem {
  name: string;
  value: string;
  isPassword: boolean;
  description: string;
}

interface ServiceIdentifier {
  hostId: number;
  serviceId: number;
}

// Helper Functions
function toIsoUtc(datetime: string): string {
  const dt = new Date(datetime.replace(' ', 'T') + 'Z');
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatMacros(macroItems: MacroItem[]): IDataObject[] {
  return macroItems.map((m) => ({
    name: m.name,
    value: m.value,
    is_password: m.isPassword,
    description: m.description,
  }));
}

function validateDateRange(startTime: string, endTime: string, node: any): void {
  if (new Date(startTime) >= new Date(endTime)) {
    throw new NodeOperationError(node, 'Start time must be before end time');
  }
}

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
      async getServices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        // 1) Credentials & version
        const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
        const version = this.getNodeParameter('version', 0) as string;
        const baseUrl = creds.baseUrl.replace(/\/+$/, '');
        const ignoreSsl = creds.ignoreSsl as boolean;

        // 2) Authenticate
        let token: string;
        try {
          const authResp = await this.helpers.request({
            method: 'POST',
            uri: `${baseUrl}/api/${version}/login`,
            headers: { 'Content-Type': 'application/json' },
            body: { security: { credentials: { login: creds.username, password: creds.password } } },
            json: true,
            rejectUnauthorized: !ignoreSsl,
          });
          token = (authResp as any).security?.token;
          if (!token) {
            throw new NodeOperationError(this.getNode(), 'No authentication token returned from Centreon');
          }
        } catch (err: any) {
          throw new NodeApiError(this.getNode(), err, { message: 'Failed to authenticate to Centreon' });
        }

        // 3) Single GET with high limit (as requested to keep)
        let resp: any;
        try {
          resp = await this.helpers.request({
            method: 'GET',
            uri: `${baseUrl}/api/${version}/monitoring/services`,
            headers: {
              'Content-Type': 'application/json',
              'X-AUTH-TOKEN': token,
            },
            qs: { limit: 500000 },
            json: true,
            rejectUnauthorized: !ignoreSsl,
          });
        } catch (err: any) {
          throw new NodeApiError(this.getNode(), err, { message: 'Failed to fetch services' });
        }

        if (!Array.isArray(resp.result)) {
          throw new NodeOperationError(this.getNode(), 'Unexpected response format: "result" is not an array');
        }

        // 4) Map every item, assume item.hosts always present
        return (resp.result as Array<any>).map((item) => {
          const hostObj = item.host || {};
          const hostName =
            hostObj.display_name ||
            hostObj.name ||
            hostObj.alias ||
            'Unknown Host';

          const serviceId = item.id as number;
          const serviceName =
            item.display_name ||
            item.description ||
            `Service ${serviceId}`;

          return {
            name: `${hostName} – ${serviceName}`,
            value: JSON.stringify({ hostId: hostObj.id, serviceId }),
          } as INodePropertyOptions;
        });
      }
    }
  };

  description: INodeTypeDescription = {
    displayName: 'Centreon',
    name: 'centreon',
    icon: 'file:centreon.svg',
    group: ['transform'],
    version: 1,
    subtitle: '{{ $parameter.resource }}: {{ $parameter.operation }}',
    description: 'Connect and manage Centreon using Centreon Web API (v2)',
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
        description: 'Version of the API (e.g., latest, v24.10)',
      },
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Host', value: 'host' },
          { name: 'Service', value: 'service' },
          { name: 'Monitoring Server', value: 'monitoringServer' },
        ],
        default: 'host',
        description: 'Centreon resource type',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'List', value: 'list', action: 'List hosts' },
          { name: 'Add', value: 'add', action: 'Add a host' },
          { name: 'Delete', value: 'delete', action: 'Delete a host' },
          { name: 'Acknowledge', value: 'ack', action: 'Acknowledge a host' },
          { name: 'Downtime', value: 'downtime', action: 'Schedule downtime for a host' },
        ],
        default: 'list',
        displayOptions: {
          show: {
            resource: ['host'],
          },
        },
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'List', value: 'list', action: 'List services' },
          { name: 'Add', value: 'add', action: 'Add a service' },
          { name: 'Delete', value: 'delete', action: 'Delete a service' },
          { name: 'Acknowledge', value: 'ack', action: 'Acknowledge a service' },
          { name: 'Downtime', value: 'downtime', action: 'Schedule downtime for a service' },
        ],
        default: 'list',
        displayOptions: {
          show: {
            resource: ['service'],
          },
        },
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'List', value: 'list', action: 'List monitoring servers' },
          { name: 'Apply Configuration', value: 'applyConfiguration', action: 'Apply configuration to monitoring servers' },
        ],
        default: 'list',
        displayOptions: {
          show: {
            resource: ['monitoringServer'],
          },
        },
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
        description: 'Name of the host to create',
      },
      {
        displayName: 'Address',
        name: 'address',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['host'], operation: ['add'] } },
        description: 'IP address of the host',
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
        displayName: 'Macros',
        name: 'macros',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: true,
        },
        placeholder: 'Add Macro',
        default: { macroValues: [] },
        displayOptions: {
          show: {
            resource: ['host'],
            operation: ['add'],
          },
        },
        description: 'Define one or more macros for this resource',
        options: [
          {
            displayName: 'Macro',
            name: 'macroValues',
            values: [
              {
                displayName: 'Name',
                name: 'name',
                type: 'string',
                default: '',
                required: true,
                description: 'Name of the macro',
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                required: true,
                description: 'Value of the macro',
              },
              {
                displayName: 'Is Password',
                name: 'isPassword',
                type: 'boolean',
                default: false,
                description: 'Whether this macro is a password',
              },
              {
                displayName: 'Description',
                name: 'description',
                type: 'string',
                default: '',
                description: 'Optional description of the macro',
              },
            ],
          },
        ],
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
      // ---- HOST: DELETE ----
      {
        displayName: 'Host Name or ID',
        name: 'hostId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getHosts' },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['delete'] },
        },
        description: 'The host to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      // ---- HOST: ACK ----
      {
        displayName: 'Host Name or ID',
        name: 'hostId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getHosts' },
        default: '',
        displayOptions: {
          show: { resource: ['host'], operation: ['ack'] },
        },
        description: 'The host to acknowledge. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Comment',
        name: 'comment',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['ack'] },
        },
        description: 'Reason for the acknowledgment (required)',
      },
      {
        displayName: 'Notify',
        name: 'notify',
        type: 'boolean',
        default: false,
        displayOptions: { show: { resource: ['host'], operation: ['ack'] } },
        description: 'Whether to send a notification to the host\'s contacts',
      },
      {
        displayName: 'Sticky',
        name: 'sticky',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['host'], operation: ['ack'] },
        },
        description: "Whether to keep the acknowledgement on state change",
      },
      {
        displayName: 'Persistent',
        name: 'persistent',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['host'], operation: ['ack'] },
        },
        description: "Whether to keep the acknowledgement after scheduler restart",
      },
      {
        displayName: 'Acknowledge Services Attached',
        name: 'ackServices',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['host'], operation: ['ack'] },
        },
        description: "Whether to acknowledge the host's services",
      },
      // ---- HOST: DOWNTIME ----
      {
        displayName: 'Host Name or ID',
        name: 'hostId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getHosts' },
        default: '',
        displayOptions: {
          show: { resource: ['host'], operation: ['downtime'] },
        },
        description: 'Choose the host to put into downtime. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Comment',
        name: 'comment',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['downtime'] },
        },
        description: 'Reason for the downtime',
      },
      {
        displayName: 'Start Time',
        name: 'startTime',
        type: 'dateTime',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['downtime'] },
        },
        description: 'UTC start time (YYYY-MM-DDThh:mm:ssZ)',
      },
      {
        displayName: 'End Time',
        name: 'endTime',
        type: 'dateTime',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['downtime'] },
        },
        description: 'UTC end time (YYYY-MM-DDThh:mm:ssZ)',
      },
      {
        displayName: 'Fixed',
        name: 'fixed',
        type: 'boolean',
        default: true,
        displayOptions: {
          show: { resource: ['host'], operation: ['downtime'] },
        },
        description: 'Whether the downtime is fixed',
      },
      {
        displayName: 'Schedule Downtime for Services Attached to the Host',
        name: 'withservices',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['host'], operation: ['downtime'] },
        },
        description: 'Whether the downtime is applied to services also',
      },
      {
        displayName: 'Duration in Seconds',
        name: 'duration',
        type: 'number',
        default: 3600,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { resource: ['host'], operation: ['downtime'] } },
        description: 'Duration of the downtime',
      },
      // ---- SERVICE: LIST ----
      {
        displayName: 'Host Name or ID',
        name: 'hostId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getHosts' },
        default: '',
        displayOptions: {
          show: { resource: ['service'], operation: ['list'] },
        },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
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
        displayName: 'Host Name or ID',
        name: 'hostId',
        type: 'options',
        default: '',
        typeOptions: { loadOptionsMethod: 'getHosts' },
        required: true,
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Service Name',
        name: 'servicename',
        default: '',
        type: 'string',
        required: true,
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Service Name to create',
      },
      {
        displayName: 'Template Name or ID',
        name: 'servicetemplates',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getServiceTemplates' },
        default: '',
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Service template to apply. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Macros',
        name: 'macros',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: true,
        },
        placeholder: 'Add Macro',
        default: { macroValues: [] },
        displayOptions: {
          show: {
            resource: ['service'],
            operation: ['add'],
          },
        },
        description: 'Define one or more macros for this resource',
        options: [
          {
            displayName: 'Macro',
            name: 'macroValues',
            values: [
              {
                displayName: 'Name',
                name: 'name',
                type: 'string',
                default: '',
                required: true,
                description: 'Name of the macro',
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                required: true,
                description: 'Value of the macro',
              },
              {
                displayName: 'Is Password',
                name: 'isPassword',
                type: 'boolean',
                default: false,
                description: 'Whether this macro is a password',
              },
              {
                displayName: 'Description',
                name: 'description',
                type: 'string',
                default: '',
                description: 'Optional description of the macro',
              },
            ],
          },
        ],
      },
      // ---- SERVICE: DELETE ----
      {
        displayName: 'Service Name or ID',
        name: 'service',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getServices' },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['service'], operation: ['delete'] },
        },
        description: 'Service to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      // ---- SERVICE: DOWNTIME ----
      {
        displayName: 'Service Name or ID',
        name: 'service',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getServices' },
        default: '',
        displayOptions: {
          show: { resource: ['service'], operation: ['downtime'] },
        },
        description: 'Choose the service (Host – Service) to put into downtime. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Comment',
        name: 'comment',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['service'], operation: ['downtime'] },
        },
        description: 'Reason for the downtime',
      },
      {
        displayName: 'Start Time',
        name: 'startTime',
        type: 'dateTime',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['service'], operation: ['downtime'] },
        },
        description: 'UTC start time (YYYY-MM-DDThh:mm:ssZ)',
      },
      {
        displayName: 'End Time',
        name: 'endTime',
        type: 'dateTime',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['service'], operation: ['downtime'] },
        },
        description: 'UTC end time (YYYY-MM-DDThh:mm:ssZ)',
      },
      {
        displayName: 'Fixed',
        name: 'fixed',
        type: 'boolean',
        default: true,
        displayOptions: {
          show: { resource: ['service'], operation: ['downtime'] },
        },
        description: 'Whether the downtime is fixed',
      },
      {
        displayName: 'Duration in Seconds',
        name: 'duration',
        type: 'number',
        default: 3600,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { resource: ['service'], operation: ['downtime'] } },
        description: 'Duration of the downtime',
      },
      // ---- SERVICE: ACK ----
      {
        displayName: 'Service Name or ID',
        name: 'service',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getServices' },
        default: '',
        displayOptions: {
          show: { resource: ['service'], operation: ['ack'] },
        },
        description: 'Service to acknowledge. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Comment',
        name: 'comment',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['service'], operation: ['ack'] },
        },
        description: 'Reason for the acknowledgment (required)',
      },
      {
        displayName: 'Notify',
        name: 'notify',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['service'], operation: ['ack'] },
        },
        description: 'Whether to send a notification to the service\'s contacts',
      },
      {
        displayName: 'Sticky',
        name: 'sticky',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['service'], operation: ['ack'] },
        },
        description: "Whether to keep the acknowledgement on state change",
      },
      {
        displayName: 'Persistent',
        name: 'persistent',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { resource: ['service'], operation: ['ack'] },
        },
        description: "Whether to keep acknowledge even if the engine restarts",
      },
      // ---- MONITORING SERVER: LIST ----
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 50,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { resource: ['monitoringServer'], operation: ['list'] } },
        description: 'Max number of results to return',
      },
      // ---- MONITORING SERVER: APPLY CONFIGURATION ----
      {
        displayName: 'Monitoring Servers Names or IDs',
        name: 'monitoringServerIds',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getMonitoringServers' },
        required: true,
        default: [],
        displayOptions: { 
          show: { 
            resource: ['monitoringServer'], 
            operation: ['applyConfiguration'] 
          } 
        },
        description: 'Select monitoring servers to apply configuration to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Continue on Fail',
        name: 'continueOnFail',
        type: 'boolean',
        default: false,
        displayOptions: { 
          show: { 
            resource: ['monitoringServer'], 
            operation: ['applyConfiguration'] 
          } 
        },
        description: 'Whether to continue processing other monitoring servers if one fails',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
    const version = this.getNodeParameter('version', 0) as string;
    const ignoreSsl = creds.ignoreSsl as boolean;
    const token = await getAuthToken.call(this, creds, version);

    const items = this.getInputData();
    const returnData: IDataObject[] = [];

    for (let i = 0; i < items.length; i++) {
      const resource = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;
      let responseData: any;

      try {
        if (resource === 'host') {
          responseData = await executeHostOperation.call(this, operation, i, creds, token, version, ignoreSsl);
        } else if (resource === 'service') {
          responseData = await executeServiceOperation.call(this, operation, i, creds, token, version, ignoreSsl);
        } else if (resource === 'monitoringServer') {
          responseData = await executeMonitoringServerOperation.call(this, operation, i, creds, token, version, ignoreSsl);
        }

        if (responseData !== undefined) {
          returnData.push(responseData as IDataObject);
        }
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ error: error.message });
          continue;
        }
        throw error;
      }
    }

    const executionData = returnData.map((d) => ({ json: d })) as INodeExecutionData[];
    return this.prepareOutputData(executionData);
  }
}

// Helper Functions for operations
async function executeHostOperation(
  this: IExecuteFunctions,
  operation: string,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  switch (operation) {
    case 'list':
      return executeHostList.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'add':
      return executeHostAdd.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'delete':
      return executeHostDelete.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'ack':
      return executeHostAck.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'downtime':
      return executeHostDowntime.call(this, itemIndex, creds, token, version, ignoreSsl);
    default:
      throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
  }
}

async function executeServiceOperation(
  this: IExecuteFunctions,
  operation: string,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  switch (operation) {
    case 'list':
      return executeServiceList.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'add':
      return executeServiceAdd.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'delete':
      return executeServiceDelete.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'ack':
      return executeServiceAck.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'downtime':
      return executeServiceDowntime.call(this, itemIndex, creds, token, version, ignoreSsl);
    default:
      throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
  }
}

async function executeMonitoringServerOperation(
  this: IExecuteFunctions,
  operation: string,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  switch (operation) {
    case 'list':
      return executeMonitoringServerList.call(this, itemIndex, creds, token, version, ignoreSsl);
    case 'applyConfiguration':
      return executeMonitoringServerApplyConfiguration.call(this, itemIndex, creds, token, version, ignoreSsl);
    default:
      throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
  }
}

async function executeHostList(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const filterName = this.getNodeParameter('filterName', itemIndex, '') as string;
  const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
  const params: string[] = [];
  
  if (filterName) {
    const searchObj = { $and: [{ 'host.name': { $lk: filterName } }] };
    params.push(`search=${encodeURIComponent(JSON.stringify(searchObj))}`);
  }
  if (limit) {
    params.push(`limit=${limit}`);
  }
  
  const qs = params.length ? `?${params.join('&')}` : '';
  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'GET',
      endpoint: `/monitoring/hosts${qs}`,
    },
    ignoreSsl,
    version,
  );
}

async function executeHostAdd(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const name = this.getNodeParameter('name', itemIndex) as string;
  const address = this.getNodeParameter('address', itemIndex) as string;
  const monitoringServerId = this.getNodeParameter('monitoringServerId', itemIndex) as number;
  const templates = this.getNodeParameter('templates', itemIndex, []) as number[];
  const hostgroups = this.getNodeParameter('hostgroups', itemIndex, []) as number[];
  const macroItems = this.getNodeParameter('macros.macroValues', itemIndex, []) as MacroItem[];

  const macros = formatMacros(macroItems);

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'POST',
      endpoint: '/configuration/hosts',
      body: {
        name,
        alias: name,
        address,
        monitoring_server_id: monitoringServerId,
        templates,
        groups: hostgroups,
        macros,
      },
    },
    ignoreSsl,
    version,
  );
}

async function executeHostDelete(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const hostId = this.getNodeParameter('hostId', itemIndex) as number;

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'DELETE',
      endpoint: `/configuration/hosts/${hostId}`,
    },
    ignoreSsl,
    version,
  );
}

async function executeHostAck(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const hostId = this.getNodeParameter('hostId', itemIndex) as number;
  const comment = this.getNodeParameter('comment', itemIndex) as string;
  const notify = this.getNodeParameter('notify', itemIndex) as boolean;
  const sticky = this.getNodeParameter('sticky', itemIndex) as boolean;
  const persistent = this.getNodeParameter('persistent', itemIndex) as boolean;
  const ackServices = this.getNodeParameter('ackServices', itemIndex) as boolean;

  const body: IDataObject = {
    comment,
    is_notify_contacts: notify,
    is_sticky: sticky,
    is_persistent_comment: persistent,
    with_services: ackServices,
  };

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'POST',
      endpoint: `/monitoring/hosts/${hostId}/acknowledgements`,
      body,
    },
    ignoreSsl,
    version,
  );
}

async function executeHostDowntime(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const hostId = this.getNodeParameter('hostId', itemIndex) as number;
  const comment = this.getNodeParameter('comment', itemIndex) as string;
  const fixed = this.getNodeParameter('fixed', itemIndex) as boolean;
  const duration = this.getNodeParameter('duration', itemIndex) as number;
  const withservice = this.getNodeParameter('withservices', itemIndex) as boolean;
  const rawStart = this.getNodeParameter('startTime', itemIndex) as string;
  const rawEnd = this.getNodeParameter('endTime', itemIndex) as string;

  validateDateRange(rawStart, rawEnd, this.getNode());

  const startTime = toIsoUtc(rawStart);
  const endTime = toIsoUtc(rawEnd);

  const body: IDataObject = {
    comment,
    start_time: startTime,
    end_time: endTime,
    is_fixed: fixed,
    duration: duration,
    with_services: withservice,
  };

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'POST',
      endpoint: `/monitoring/hosts/${hostId}/downtimes`,
      body,
    },
    ignoreSsl,
    version,
  );
}

async function executeServiceList(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const filterName = this.getNodeParameter('filterName', itemIndex, '') as string;
  const hostId = this.getNodeParameter('hostId', itemIndex, '') as number;
  const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
  const params: string[] = [];
  const and: IDataObject[] = [];
  
  if (filterName) {
    and.push({ 'service.name': { $lk: filterName } });
  }
  if (hostId) {
    and.push({ 'host.id': { $eq: hostId } });
  }
  if (and.length) {
    const searchObj = { $and: and };
    params.push(`search=${encodeURIComponent(JSON.stringify(searchObj))}`);
  }
  if (limit) {
    params.push(`limit=${limit}`);
  }
  
  const qs = params.length ? `?${params.join('&')}` : '';
  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'GET',
      endpoint: `/monitoring/services${qs}`,
    },
    ignoreSsl,
    version,
  );
}

async function executeServiceAdd(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const name = this.getNodeParameter('servicename', itemIndex) as string;
  const hostId = this.getNodeParameter('hostId', itemIndex) as number;
  const template = this.getNodeParameter('servicetemplates', itemIndex) as number;
  const macroItems = this.getNodeParameter('macros.macroValues', itemIndex, []) as MacroItem[];

  const macros = formatMacros(macroItems);

  const body: IDataObject = {
    name,
    host_id: hostId,
    service_template_id: template,
    macros,
  };

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'POST',
      endpoint: '/configuration/services',
      body,
    },
    ignoreSsl,
    version,
  );
}

async function executeServiceDelete(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const serviceJson = this.getNodeParameter('service', itemIndex) as string;
  const { serviceId } = JSON.parse(serviceJson) as ServiceIdentifier;

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'DELETE',
      endpoint: `/configuration/services/${serviceId}`,
    },
    ignoreSsl,
    version,
  );
}

async function executeServiceAck(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const serviceJson = this.getNodeParameter('service', itemIndex) as string;
  const { hostId, serviceId } = JSON.parse(serviceJson) as ServiceIdentifier;

  const comment = this.getNodeParameter('comment', itemIndex) as string;
  const notify = this.getNodeParameter('notify', itemIndex) as boolean;
  const sticky = this.getNodeParameter('sticky', itemIndex) as boolean;
  const persistent = this.getNodeParameter('persistent', itemIndex) as boolean;

  const body: IDataObject = {
    comment,
    is_notify_contacts: notify,
    is_sticky: sticky,
    is_persistent_comment: persistent,
  };

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'POST',
      endpoint: `/monitoring/hosts/${hostId}/services/${serviceId}/acknowledgements`,
      body,
    },
    ignoreSsl,
    version,
  );
}

async function executeServiceDowntime(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const serviceJson = this.getNodeParameter('service', itemIndex) as string;
  const { hostId, serviceId } = JSON.parse(serviceJson) as ServiceIdentifier;
  
  const comment = this.getNodeParameter('comment', itemIndex) as string;
  const rawStart = this.getNodeParameter('startTime', itemIndex) as string;
  const rawEnd = this.getNodeParameter('endTime', itemIndex) as string;
  const fixed = this.getNodeParameter('fixed', itemIndex) as boolean;
  const duration = this.getNodeParameter('duration', itemIndex) as number;

  validateDateRange(rawStart, rawEnd, this.getNode());

  const startTime = toIsoUtc(rawStart);
  const endTime = toIsoUtc(rawEnd);

  const body: IDataObject = {
    comment,
    start_time: startTime,
    end_time: endTime,
    is_fixed: fixed,
    duration,
  };

  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'POST',
      endpoint: `/monitoring/hosts/${hostId}/services/${serviceId}/downtimes`,
      body,
    },
    ignoreSsl,
    version,
  );
}

async function executeMonitoringServerList(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
  
  return centreonRequest.call(
    this,
    creds,
    token,
    {
      method: 'GET',
      endpoint: `/configuration/monitoring-servers?limit=${limit}`,
    },
    ignoreSsl,
    version,
  );
}

async function executeMonitoringServerApplyConfiguration(
  this: IExecuteFunctions,
  itemIndex: number,
  creds: ICentreonCreds,
  token: string,
  version: string,
  ignoreSsl: boolean,
): Promise<any> {
  const monitoringServerIds = this.getNodeParameter('monitoringServerIds', itemIndex) as number[];

  if (!monitoringServerIds || monitoringServerIds.length === 0) {
    throw new NodeOperationError(this.getNode(), 'At least one monitoring server must be selected');
  }

  // On doit faire un appel pour chaque monitoring server
  const results = [];
  for (const monitoringServerId of monitoringServerIds) {
    try {
      const result = await centreonRequest.call(
        this,
        creds,
        token,
        {
          method: 'POST',
          endpoint: `/configuration/monitoring-servers/${monitoringServerId}/generate-and-reload`,
          body: {},
        },
        ignoreSsl,
        version,
      );
      
      results.push({
        monitoring_server_id: monitoringServerId,
        status: 'success',
        result,
      });
    } catch (error) {
      results.push({
        monitoring_server_id: monitoringServerId,
        status: 'error',
        error: error.message,
      });
      
      // Si on veut arrêter à la première erreur
      if (!this.continueOnFail()) {
        throw error;
      }
    }
  }

  return { results };
}

/** Helper: auth + generic request */
async function fetchFromCentreon(
  this: ILoadOptionsFunctions,
  endpoint: string,
): Promise<INodePropertyOptions[]> {
  const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
  const version = this.getNodeParameter('version', 0) as string;
  const baseUrl = creds.baseUrl.replace(/\/+$/, '');
  const ignoreSsl = creds.ignoreSsl as boolean;

  const authResp = (await this.helpers.request({
    method: 'POST',
    uri: `${baseUrl}/api/${version}/login`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      security: {
        credentials: {
          login: creds.username,
          password: creds.password,
        },
      },
    },
    json: true,
    rejectUnauthorized: !ignoreSsl,
  })) as { security?: { token?: string } };

  const token = authResp.security?.token;
  if (!token) {
    throw new NodeOperationError(this.getNode(), 'Cannot authenticate to Centreon');
  }

  const limit = 100;
  let page = 1;
  const allItems: Array<{ id: number; name: string }> = [];

  while (true) {
    const resp = (await this.helpers.request({
      method: 'GET',
      uri: `${baseUrl}/api/${version}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-TOKEN': token,
      },
      qs: { page, limit },
      json: true,
      rejectUnauthorized: !ignoreSsl,
    })) as {
      result: Array<{ id: number; name: string }>;
      meta?: { pagination: { total: number; page: number; limit: number } };
    };

    allItems.push(...resp.result);

    const meta = resp.meta?.pagination;
    if (!meta || meta.page * meta.limit >= meta.total) {
      break;
    }
    page++;
  }

  return allItems.map((item: { id: number; name: string }) => ({
    name: item.name,
    value: item.id,
  }));
}

async function getAuthToken(
  this: IExecuteFunctions,
  creds: ICentreonCreds,
  version: string,
): Promise<string> {
  const resp = (await this.helpers.request({
    method: 'POST',
    uri: `${creds.baseUrl.replace(/\/+$/, '')}/api/${version}/login`,
    headers: { 'Content-Type': 'application/json' },
    body: { security: { credentials: { login: creds.username, password: creds.password } } },
    json: true,
    rejectUnauthorized: !creds.ignoreSsl,
  } as any)) as { security?: { token?: string } };

  if (!resp.security?.token) throw new NodeOperationError(this.getNode(), 'Authentication failed');
  return resp.security.token;
}

async function centreonRequest(
  this: IExecuteFunctions,
  creds: ICentreonCreds,
  token: string,
  options: CentreonRequestOptions,
  ignoreSsl: boolean,
  version: string,
): Promise<any> {
  const requestOptions: any = {
    method: options.method,
    uri: `${creds.baseUrl.replace(/\/+$/, '')}/api/${version}${options.endpoint}`,
    headers: { 'Content-Type': 'application/json', 'X-AUTH-TOKEN': token },
    json: true,
    rejectUnauthorized: !ignoreSsl,
  };

  if (options.body) {
    requestOptions.body = options.body;
  }

  if (options.params) {
    requestOptions.qs = options.params;
  }

  return this.helpers.request(requestOptions);
}
