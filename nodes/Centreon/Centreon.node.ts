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
      async getServices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	  const creds   = (await this.getCredentials('centreonApi')) as ICentreonCreds;
	  const version = this.getNodeParameter('version', 0) as string;
	  const baseUrl = creds.baseUrl.replace(/\/+$/, '');

	  // 1) Authent
	  const auth = await this.helpers.request({
		method: 'POST',
		uri:    `${baseUrl}/api/${version}/login`,
		headers:{ 'Content-Type': 'application/json' },
		body:   { security: { credentials: { login: creds.username, password: creds.password } } },
		json: true,
		rejectUnauthorized: false,
	  }) as { security?: { token?: string } };
	  const token = auth.security?.token;
	  if (!token) {
		throw new NodeOperationError(this.getNode(), 'Cannot authenticate to Centreon');
	  }

	  // 2) Pagination manuelle
	  const limit = 100;
	  let page    = 1;
	  const all: Array<{
		hosts: { id: number; name: string };
		id: number;
		display_name: string;
	  }> = [];

	  while (true) {
		const resp = await this.helpers.request({
		  method: 'GET',
		  uri:    `${baseUrl}/api/${version}/monitoring/services`,
		  headers:{
			'Content-Type':  'application/json',
			'X-AUTH-TOKEN':   token,
		  },
		  qs: { page, limit },
		  json: true,
		  rejectUnauthorized: false,
		}) as {
		  result: typeof all;
		  meta?: { pagination: { total: number; page: number; limit: number } };
		};

		all.push(...resp.result);

		const meta = resp.meta?.pagination;
		if (!meta || meta.page * meta.limit >= meta.total) {
		  break;
		}
		page++;
	  }

	  // 3) Construction des options dynamiques
	  return all.map(item => {
		const host = item.hosts; // objet hôte :contentReference[oaicite:0]{index=0}
		return {
		  name:  `${host.name} – ${item.display_name}`,
		  value: JSON.stringify({ hostId: host.id, serviceId: item.id }),
		};
	  });
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
	  { name: 'Acknowledge', value: 'ack' },
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
	      resource: ['host'],        // ou ['service'] pour le bloc service:add
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
	  description: 'Choisissez l’hôte à acquitter (ID ou à partir de la liste). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
	  description: 'Raison de l’acquittement (obligatoire)',
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
	  description: "Whether to acknowledge the host\'s services",
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
        description: 'Hôte associé au service. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
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
        displayName: 'Template(s) Names or Name or ID',
        name: 'servicetemplates',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getServiceTemplates' },
        default: '',
        displayOptions: { show: { resource: ['service'], operation: ['add'] } },
        description: 'Templates de service à appliquer. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
              resource: ['service'],        // ou ['service'] pour le bloc service:add
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
	  description: 'Service à acquitter. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
	  description: 'Raison de l’acquittement (obligatoire)',
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
	  const macroItems = this.getNodeParameter(
	    'macros.macroValues',
	    i,
	    [],
	  ) as Array<{
	  name: string;
	  value: string;
	  isPassword: boolean;
	  description: string;
	}>;

	// Transforme en format API Centreon
	const macros = macroItems.map((m) => {
	  return {
	    name:        m.name,
	    value:       m.value,
	    is_password: m.isPassword,
	    description: m.description,  // toujours présent, même vide
	  } as IDataObject;
	});
          responseData = await centreonRequest.call(
            this, creds, token, 'POST', '/configuration/hosts',
            { name, alias: name, address, monitoring_server_id: monitoringServerId, templates, groups: hostgroups , macros},
            ignoreSsl, version,
          );
        } else if (operation === 'ack') {
	const hostId      = this.getNodeParameter('hostId',      i) as number;
	  const comment     = this.getNodeParameter('comment',     i) as string;
	  const notify      = this.getNodeParameter('notify',      i) as boolean;
	  const sticky      = this.getNodeParameter('sticky',      i) as boolean;
	  const persistent  = this.getNodeParameter('persistent',  i) as boolean;
	  const ackServices = this.getNodeParameter('ackServices', i) as boolean;

	  const body: IDataObject = {
		comment,
		notify,
		sticky,
		persistent,
		acknowledge_services: ackServices,
	  };

	  responseData = await centreonRequest.call(
		this,
		creds,
		token,
		'POST',
		`/monitoring/hosts/${hostId}/acknowledgements`,
		body,
		ignoreSsl,
		version,
	  );
        }
      }
      else if (resource === 'service') {
        if (operation === 'list') {
          const filterName = this.getNodeParameter('filterName', i, '') as string;
	  const hostId     = this.getNodeParameter('hostId', i, '') as number;
          const limit      = this.getNodeParameter('limit', i, 50) as number;
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
          responseData = await centreonRequest.call(
            this, creds, token, 'GET', `/monitoring/services${qs}`, {}, ignoreSsl, version,
          );
        } else if (operation === 'add') {
          const name      = this.getNodeParameter('servicename', i) as string;
          const hostId    = this.getNodeParameter('hostId', i) as number;
          const template = this.getNodeParameter('servicetemplates', i) as number;
	  const macroItems = this.getNodeParameter(
            'macros.macroValues',
            i,
            [],
          ) as Array<{
          name: string;
          value: string;
          isPassword: boolean;
          description: string;
        }>;

        // Transforme en format API Centreon
        const macros = macroItems.map((m) => {
          return {
            name:        m.name,
            value:       m.value,
            is_password: m.isPassword,
            description: m.description,
          } as IDataObject;
        });
          const body: IDataObject = { name, host_id: hostId, service_template_id: template, macros };
          responseData = await centreonRequest.call(
            this, creds, token, 'POST', '/configuration/services', body, ignoreSsl, version,
          );
        } else if (operation === 'ack') {
	  	// 1) Récupère et parse le JSON
	const serviceJson = this.getNodeParameter('service', i) as string;
	let { hostId, serviceId } = JSON.parse(serviceJson) as {
	  hostId: number;
	  serviceId: number;
	};

	// 2) Les autres paramètres
	const comment    = this.getNodeParameter('comment',    i) as string;
	const notify     = this.getNodeParameter('notify',     i) as boolean;
	const sticky     = this.getNodeParameter('sticky',     i) as boolean;
	const persistent = this.getNodeParameter('persistent', i) as boolean;

	// 3) Build body
	const body: IDataObject = { comment, notify, sticky, persistent };

	// 4) Appel de l’API
	responseData = await centreonRequest.call(
	  this,
	  creds,
	  token,
	  'POST',
	  `/monitoring/hosts/${hostId}/services/${serviceId}/acknowledgements`,
	  body,
	  ignoreSsl,
	  version,
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
  // 1) Récupère les credentials et la version
  const creds = (await this.getCredentials('centreonApi')) as ICentreonCreds;
  const version = this.getNodeParameter('version', 0) as string;
  const baseUrl = creds.baseUrl.replace(/\/+$/, '');

  // 2) Authentification
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
    rejectUnauthorized: false,
  })) as { security?: { token?: string } };

  const token = authResp.security?.token;
  if (!token) {
    throw new NodeOperationError(this.getNode(), 'Cannot authenticate to Centreon');
  }

  // 3) Pagination manuelle
  const limit = 100;  // tu peux ajuster
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
      rejectUnauthorized: false,
    })) as {
      result: Array<{ id: number; name: string }>;
      meta?: { pagination: { total: number; page: number; limit: number } };
    };

    // Ajoute les résultats de cette page
    allItems.push(...resp.result);

    // Si pas de pagination ou qu'on a tout récupéré, on sort
    const meta = resp.meta?.pagination;
    if (!meta || meta.page * meta.limit >= meta.total) {
      break;
    }
    page++;
  }

  // 4) Retourne sous forme d'options dynamiques
  return allItems.map((item: { id: number; name: string }) => ({
    name: item.name,
    value: item.id,
  }));
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

