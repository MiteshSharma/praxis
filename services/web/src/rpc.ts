import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { type Contract, contract } from '@shared/contracts';

const link = new RPCLink({ url: 'http://localhost:3000/rpc' });

export const rpc: ContractRouterClient<Contract> = createORPCClient(link);

// Keep a runtime reference to avoid tree-shaking of the contract module when
// types are the only consumer.
void contract;
