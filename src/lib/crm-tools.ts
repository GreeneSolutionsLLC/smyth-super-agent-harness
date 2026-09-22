// ── CRM Tools ──
// Wraps the Twenty CRM MCP endpoint (running on localhost:4000/mcp).
// Uses the MCP server's execute_tool meta-tool for all CRUD operations.
// The user signs up through the Twenty UI; these tools use the server-side
// API key (TWENTY_API_KEY) for agent access.

const TWENTY_URL = process.env.TWENTY_URL || "http://localhost:4000";
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || "";

async function mcpExecute(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  if (!TWENTY_API_KEY) {
    return "Error: TWENTY_API_KEY not set in environment. Sign up at http://localhost:4000 and generate a token in Settings → API.";
  }
  try {
    const res = await fetch(`${TWENTY_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TWENTY_API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: "execute_tool",
          arguments: {
            toolName,
            arguments: args,
          },
        },
      }),
    });
    const json = await res.json();
    if (json.error) {
      return `MCP error: ${json.error.message || JSON.stringify(json.error)}`;
    }
    // MCP returns content array with text items
    const content = json.result?.content;
    if (Array.isArray(content)) {
      return content
        .map((c: any) => (typeof c === "string" ? c : c.text || JSON.stringify(c)))
        .join("\n");
    }
    return JSON.stringify(json.result, null, 2);
  } catch (err: any) {
    return `Error: ${err.message || err}`;
  }
}

// ── Tool implementations ──

export const crmTools = [
  {
    name: "crm_diagnose",
    description:
      "Check if the CRM server is running and authenticated. Returns health status and current user info.",
    parameters: { type: "object" as const, properties: {} },
    handler: async () => {
      if (!TWENTY_API_KEY) {
        return "CRM server is running but no API key is set. Go to http://localhost:4000, sign up for an account, then go to Settings → API and generate a token. Set it as TWENTY_API_KEY in .env.local.";
      }
      // Try a simple find to verify connectivity
      const result = await mcpExecute("find_many_people", {
        select: ["id"],
        limit: 1,
      });
      if (result.startsWith("Error") || result.startsWith("MCP error")) {
        return `CRM connection failed: ${result}`;
      }
      return `CRM connected successfully. TWENTY_API_KEY is set, MCP endpoint at ${TWENTY_URL}/mcp is responding. Sample query returned: ${result.slice(0, 200)}`;
    },
  },
  {
    name: "crm_list_people",
    description:
      "List all people/contacts in the CRM. Returns name, email, phone, company, and stage for each.",
    parameters: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
        search: { type: "string", description: "Filter by name or email" },
      },
    },
    handler: async (args: any) => {
      const limit = args.limit || 20;
      const search = args.search || "";
      const filter: Record<string, unknown> = { limit, select: ["*"] };
      if (search) {
        filter.name = { ilike: `%${search}%` };
      }
      return mcpExecute("find_many_people", filter);
    },
  },
  {
    name: "crm_create_person",
    description: "Create a new contact/person in the CRM.",
    parameters: {
      type: "object" as const,
      properties: {
        firstName: { type: "string", description: "First name" },
        lastName: { type: "string", description: "Last name" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number" },
        jobTitle: { type: "string", description: "Job title" },
        companyName: { type: "string", description: "Company name" },
      },
      required: ["firstName", "lastName"],
    },
    handler: async (args: any) => {
      const record: Record<string, unknown> = {
        name: { firstName: args.firstName, lastName: args.lastName },
      };
      if (args.email) record.emails = { primaryEmail: args.email };
      if (args.phone) record.phones = { primaryPhoneNumber: args.phone };
      if (args.jobTitle) record.jobTitle = args.jobTitle;
      if (args.companyName) record.companyName = args.companyName;
      return mcpExecute("create_one_person", record);
    },
  },
  {
    name: "crm_update_person",
    description: "Update an existing contact by ID.",
    parameters: {
      type: "object" as const,
      properties: {
        personId: { type: "string", description: "Person UUID" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        jobTitle: { type: "string" },
      },
      required: ["personId"],
    },
    handler: async (args: any) => {
      const record: Record<string, unknown> = {};
      if (args.firstName || args.lastName) {
        record.name = {
          ...(args.firstName ? { firstName: args.firstName } : {}),
          ...(args.lastName ? { lastName: args.lastName } : {}),
        };
      }
      if (args.email) record.emails = { primaryEmail: args.email };
      if (args.phone) record.phones = { primaryPhoneNumber: args.phone };
      if (args.jobTitle) record.jobTitle = args.jobTitle;
      return mcpExecute("update_one_person", {
        id: args.personId,
        ...record,
      });
    },
  },
  {
    name: "crm_delete_person",
    description: "Delete a contact by ID.",
    parameters: {
      type: "object" as const,
      properties: {
        personId: { type: "string", description: "Person UUID" },
      },
      required: ["personId"],
    },
    handler: async (args: any) =>
      mcpExecute("delete_one_person", { id: args.personId }),
  },
  {
    name: "crm_list_companies",
    description: "List all companies in the CRM.",
    parameters: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
        search: { type: "string", description: "Filter by name" },
      },
    },
    handler: async (args: any) => {
      const limit = args.limit || 20;
      const search = args.search || "";
      const filter: Record<string, unknown> = { limit, select: ["*"] };
      if (search) {
        filter.name = { ilike: `%${search}%` };
      }
      return mcpExecute("find_many_companies", filter);
    },
  },
  {
    name: "crm_create_company",
    description: "Create a new company in the CRM.",
    parameters: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Company name" },
        domainName: { type: "string", description: "Website domain" },
        industry: { type: "string", description: "Industry" },
        employeesSize: {
          type: "string",
          description:
            "Company size (e.g. '1-10', '11-50', '51-200', '201-500', '501-1000', '1001+') ",
        },
      },
      required: ["name"],
    },
    handler: async (args: any) => {
      const record: Record<string, unknown> = { name: args.name };
      if (args.domainName) record.domainName = { primaryLinkUrl: args.domainName };
      if (args.industry) record.industry = args.industry;
      if (args.employeesSize) record.employeesSize = args.employeesSize;
      return mcpExecute("create_one_company", record);
    },
  },
  {
    name: "crm_list_opportunities",
    description: "List all deals/opportunities in the CRM.",
    parameters: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
        stage: {
          type: "string",
          description:
            "Filter by pipeline stage (NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER)",
        },
      },
    },
    handler: async (args: any) => {
      const limit = args.limit || 20;
      const filter: Record<string, unknown> = { limit, select: ["*"] };
      if (args.stage) {
        filter.stage = { eq: args.stage };
      }
      return mcpExecute("find_many_opportunities", filter);
    },
  },
  {
    name: "crm_create_opportunity",
    description: "Create a new deal/opportunity.",
    parameters: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Deal name" },
        stage: {
          type: "string",
          description:
            "Pipeline stage (NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER)",
        },
        amount: { type: "number", description: "Deal amount" },
        currency: {
          type: "string",
          description: "Currency code (e.g. USD, JPY)",
          default: "USD",
        },
        closeDate: {
          type: "string",
          description: "Expected close date (YYYY-MM-DD)",
        },
      },
      required: ["name", "stage"],
    },
    handler: async (args: any) => {
      const record: Record<string, unknown> = {
        name: args.name,
        stage: args.stage,
      };
      if (args.amount) {
        record.amount = {
          amountMicros: Math.round(args.amount * 1_000_000),
          currencyCode: args.currency || "USD",
        };
      }
      if (args.closeDate) record.closeDate = args.closeDate;
      return mcpExecute("create_one_opportunity", record);
    },
  },
  {
    name: "crm_search",
    description:
      "Search across all CRM objects (people, companies, opportunities) by keyword.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search term" },
      },
      required: ["query"],
    },
    handler: async (args: any) => {
      const q = args.query;
      // People name is composite (firstName/lastName), so search each field
      const people = await mcpExecute("find_many_people", {
        select: ["*"],
        limit: 5,
        or: [
          { name: { firstName: { ilike: `%${q}%` } } },
          { name: { lastName: { ilike: `%${q}%` } } },
          { emails: { primaryEmail: { ilike: `%${q}%` } } },
        ],
      });
      const companies = await mcpExecute("find_many_companies", {
        select: ["*"],
        limit: 5,
        name: { ilike: `%${q}%` },
      });
      const opps = await mcpExecute("find_many_opportunities", {
        select: ["*"],
        limit: 5,
        name: { ilike: `%${q}%` },
      });
      return JSON.stringify(
        { people, companies, opportunities: opps },
        null,
        2
      );
    },
  },
];