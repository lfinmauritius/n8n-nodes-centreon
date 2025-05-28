import { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Interface exportée pour typer les credentials dans ton nœud
 */
export interface ICentreonCreds {
	baseUrl: string;
	username: string;
	password: string;
}

export class CentreonApi implements ICredentialType {
	name = 'centreonApi';
	displayName = 'Centreon API';
	documentationUrl = 'https://docs.centreon.com/docs/category/api/';
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://mon-centreon.local',
			placeholder: 'https://centreon.example.com',
			required: true,
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: 'admin',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];
}

