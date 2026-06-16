import { Agent, setGlobalDispatcher } from "undici";

// Force IPv4 for all outbound fetch calls. Some networks (notably the dev
// machine here) have broken IPv6 routing to api.telegram.org, causing
// ETIMEDOUT. Forcing family: 4 at the socket level sidesteps DNS ordering
// issues that dns.setDefaultResultOrder does not reliably fix inside the
// Trigger.dev worker. Harmless in cloud environments with working IPv6.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
