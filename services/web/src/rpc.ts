import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import type { Router } from '@shared/contracts';

const link = new RPCLink({ url: 'http://localhost:3000/rpc' });

export const rpc: RouterClient<Router> = createORPCClient(link);
