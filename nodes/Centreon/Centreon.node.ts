import {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
        NodeConnectionType, 
} from 'n8n-workflow';

export class Centreon implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Centreon',
		name: 'centreon',
		icon: 'file:centreon.svg',
                subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		group: ['transform'],
		version: 1,
		description: 'Interact with Centreon REST API',
		defaults: { name: 'Centreon' },
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main'] as NodeConnectionType[],
		credentials: [{ name: 'centreonApi', required: true }],
		properties: [
			/* ----------------- Resource ----------------- */
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
                                noDataExpression: true,
				options: [
					{ name: 'Host', value: 'host' },
					{ name: 'Service', value: 'service' },
					{ name: 'Downtime', value: 'downtime' },
				],
				default: 'host',
			},
			/* ----------------- Operations ----------------- */
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
                                noDataExpression: true,
				displayOptions: { show: { resource: ['host'] } },
				options: [
					{ name: 'List Hosts', value: 'list', action: 'List a host' },
					{ name: 'Add Host', value: 'add', action: 'Add a host' },
					{ name: 'Set State', value: 'setState', action: 'Set state of host' },
				],
				default: 'list',
			},
			/* + autres paramètres d’API (nom hôte, IP, etc.) */
		],
	};

	async execute(this: IExecuteFunctions) {
		/* 1. Auth */
		const creds = await this.getCredentials('centreonApi');
		const token = await getAuthToken.call(this, creds);

		/* 2. Dispatcher */
		const items = this.getInputData();
		const returnData = [];
		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;

			let responseData;
			if (resource === 'host') {
				if (operation === 'list') {
					responseData = await centreonRequest.call(this, token, 'GET', '/monitoring/hosts');
				}
				if (operation === 'add') {
					const name = this.getNodeParameter('name', i) as string;
					const address = this.getNodeParameter('address', i) as string;

					responseData = await centreonRequest.call(
						this,
						token,
						'POST',
						'/configuration/hosts',
						{ name, address, monitoringServerId: 1 },
					);
				}
				/* etc. */
			}
			returnData.push(responseData);
		}
		return this.prepareOutputData(returnData);
	}
}

/* ----------------- Helpers ----------------- */
async function getAuthToken(this: IExecuteFunctions, creds: any): Promise<string> {
	const res = await this.helpers.httpRequest({
		method: 'POST',
		url: `${creds.baseUrl}/centreon/api/latest/login`,
		body: {
			username: creds.username,
			password: creds.password,
		},
		json: true,
	});
	return res.security.token;
}

async function centreonRequest(
	this: IExecuteFunctions,
	token: string,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	endpoint: string,
	body: object = {},
) {
	const { baseUrl } = (await this.getCredentials('centreonApi')) as any;
	return this.helpers.httpRequest({
		method,
		url: `${baseUrl}/centreon/api/latest${endpoint}`,
		headers: { 'X-AUTH-TOKEN': token },
		json: true,
		body: Object.keys(body).length ? body : undefined,
	});
}

