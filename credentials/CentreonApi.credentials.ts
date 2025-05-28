import { ICredentialType, INodeProperties } from 'n8n-workflow';

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
                {
		displayName: 'Ignore SSL errors',
		name: 'ignoreSsl',
		type: 'boolean',
		default: false,
		description: 'Skip TLS certificate validation (self-signed certs)',
	        },
	];
}
