import type { RestEndpointMethodTypes } from '@octokit/rest';

export type PullsGetResponseItem = RestEndpointMethodTypes['pulls']['get']['response']['data'];
export type PullsListResponseItem = RestEndpointMethodTypes['pulls']['list']['response']['data'][0];

export interface Branch {
  name: string;
  commit: {
    sha: string;
  };
}
