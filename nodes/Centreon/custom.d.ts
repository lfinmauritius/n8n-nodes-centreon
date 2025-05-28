import 'n8n-workflow';

declare module 'n8n-workflow' {
  // Override ILoadOptionsFunctions to avoid TS implementation errors
  export interface ILoadOptionsFunctions {}
}
