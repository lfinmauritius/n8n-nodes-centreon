import {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	IDataObject,
        INodeExecutionData,
        NodeConnectionType,
} from 'n8n-workflow';
import { ICentreonCreds } from '../../credentials/CentreonApi.credentials';

export class Centreon implements INodeType {
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
				description:
					'Version de l’API (eg. latest, v24.10)',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				options: [
					{ name: 'Host', value: 'host' },
				],
				default: 'host',
				description: 'Type de ressource Centreon',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
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
					show: {
						resource: ['host'],
						operation: ['add'],
					},
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
					show: {
						resource: ['host'],
						operation: ['add'],
					},
				},
				description: 'Adresse IP de l’hôte',
			},
			{
				displayName: 'Options avancées',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Afficher options avancées',
				default: {},
				options: [
					{
						displayName: 'Ignore SSL errors',
						name: 'ignoreSsl',
						type: 'boolean',
						default: false,
						description:
							'Ignorer les erreurs de certificat TLS (certificat autosigné)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// 1. Récupérer credentials & paramètres
		const creds = await this.getCredentials('centreonApi') as ICentreonCreds;
		const ignoreSsl = this.getNodeParameter('advancedOptions.ignoreSsl',0, false) as boolean;

		// 2. Authentification (POST /login)
		const token = await getAuthToken.call(
			this,
			creds,
			ignoreSsl,
			"latest",
		);

		// 3. Traitement des items
		const items = this.getInputData();
		const returnData: IDataObject[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter(
				'resource',
				i,
			) as string;
			const operation = this.getNodeParameter(
				'operation',
				i,
			) as string;
			let responseData: any;

			if (resource === 'host') {
				if (operation === 'list') {
					// GET /monitoring/hosts
					responseData = await centreonRequest.call(
						this,
						creds,
						token,
						'GET',
						'/monitoring/hosts',
						{},
						ignoreSsl,
						"latest",
					);
				} else if (operation === 'add') {
					const name = this.getNodeParameter(
						'name',
						i,
					) as string;
					const address = this.getNodeParameter(
						'address',
						i,
					) as string;
					// POST /configuration/hosts
					responseData = await centreonRequest.call(
						this,
						creds,
						token,
						'POST',
						'/configuration/hosts',
						{
							name,
							alias: name,
							address,
							monitoringServerId: 1,
						},
						ignoreSsl,
						"latest",
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
}

// =================================================================
// Helpers externes à la classe
// =================================================================

/**
 * Authentifie sur Centreon Web v2 et renvoie le token
 *
 * POST {baseUrl}/centreon/api/{version}/login
 * Payload: { security: { credentials: { login, password } } }
 */
async function getAuthToken(
	this: IExecuteFunctions,
	creds: ICentreonCreds,
	ignoreSsl: boolean,
	version: string,
): Promise<string> {
	const options = {
		method: 'POST',
		uri: `${creds.baseUrl}/centreon/api/${version}/login`,
		headers: {
			'Content-Type': 'application/json',
		},
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
	};
	const response = await this.helpers.request(options as any) as { security?: { token?: string } };

	if (!response.security?.token) {
		throw new Error(
			'Authentification Centreon échouée (pas de token).',
		);
	}
	return response.security.token;
}

/**
 * Effectue une requête vers Centreon Web v2 en passant le token
 * via l’en-tête X-AUTH-TOKEN :contentReference[oaicite:2]{index=2}
 */
async function centreonRequest(
	this: IExecuteFunctions,
	creds: ICentreonCreds,
	token: string,
	method: string,
	endpoint: string,
	body: IDataObject = {},
	ignoreSsl: boolean,
	version: string,
): Promise<any> {
	const options = {
		method,
		uri: `${creds.baseUrl}/centreon/api/${version}${endpoint}`,
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

