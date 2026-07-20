import { handlers } from "@/auth";

// MongoDB + node:crypto require the Node.js runtime (not edge).
export const runtime = "nodejs";

export const { GET, POST } = handlers;
