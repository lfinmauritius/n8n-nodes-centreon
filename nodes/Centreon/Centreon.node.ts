import {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
        NodeConnectionType, 
        NodeApiError,
        IHttpRequestOptions
} from 'n8n-workflow';

interface ICentreonCreds {
	baseUrl: string;
	username: string;
	password: string;
	ignoreSsl?: boolean;
}

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
                const rawCreds = await this.getCredentials('centreonApi');
                const creds = rawCreds as unknown as ICentreonCreds;

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
					responseData = await centreonRequest.call(this, creds, token, 'GET', '/monitoring/hosts');
				}
				if (operation === 'add') {
					const name = this.getNodeParameter('name', i) as string;
					const address = this.getNodeParameter('address', i) as string;
                                        const responseData = await centreonRequest.call(
                                   		this,
						creds,                 // ← nouvel argument
						token,
						'POST',
						'/configuration/hosts',
                                                {
		    					name,
							alias: name,
							address,
							monitoringServerId: 1,
						},
					);
					returnData.push(responseData); 
				}
				/* etc. */
			}
			returnData.push(responseData);
		}
		return this.prepareOutputData(returnData);
	}
}

async function getAuthToken(
	this: IExecuteFunctions,
	creds: ICentreonCreds,
): Promise<string> {
	const url = `${creds.baseUrl.replace(/\/+$/, '')}/centreon/api/latest/login`;

	const payload = {
		security: {
			credentials: {
				login: creds.username,
				password: creds.password,
			},
		},
	};

	/* --- options séparé pour éviter TS2353 --- */
	const options: IHttpRequestOptions = {
		method: 'POST',
		url,
		headers: { 'Content-Type': 'application/json' },
		json: true,
		body: payload,
	};

	// clé non typée → on la pose après coup
	(options as any).rejectUnauthorized = !creds.ignoreSsl;

	const res = await this.helpers.httpRequest(options);

	const token = res?.security?.token as string | undefined;
	if (!token) {
		throw new NodeApiError(this.getNode(), res, {
			message: 'Login failed: no token returned by Centreon',
		});
	}

	return token;
}

async function centreonRequest(
	this: IExecuteFunctions,
	creds: ICentreonCreds,           // ← on passe l’objet credential complet
	token: string,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	endpoint: string,
	body: object = {},
) {
	const options: IHttpRequestOptions = {
		method,
		url: `${creds.baseUrl.replace(/\/+$/, '')}/centreon/api/latest${endpoint}`,
		headers: { 'X-AUTH-TOKEN': token },
		json: true,
	};

	if (Object.keys(body).length) options.body = body;

	// ← ICI : on insère l’option SSL
	(options as any).rejectUnauthorized = !creds.ignoreSsl;

	return this.helpers.httpRequest(options);
}
