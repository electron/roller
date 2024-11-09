import { RestEndpointMethodTypes } from '@octokit/rest';

export type PullsListResponseItem = RestEndpointMethodTypes['pulls']['list']['response']['data'][0];
export type ReposListBranchesResponseItem =
  RestEndpointMethodTypes['repos']['listBranches']['response']['data'][0];
export type ReposGetBranchResponseItem =
  RestEndpointMethodTypes['repos']['getBranch']['response']['data'];
