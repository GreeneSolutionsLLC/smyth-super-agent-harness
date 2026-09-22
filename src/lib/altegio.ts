// ── Altegio API Client ──
// Booking & business management API for BIG (Domo's business).
// Docs: https://developer.alteg.io/en
//
// Auth: Two tokens required:
//   1. Partner token (ALTEGIO_PARTNER_TOKEN) — from Marketplace developer account
//   2. User token (ALTEGIO_USER_TOKEN) — from POST /api/v1/auth with partner token + user credentials
//
// Headers: Authorization: Bearer {partner_token}, User {user_token}
// Base URL: https://api.alteg.io/api/v1
// Rate limit: 200 req/min, 5 req/sec per IP

const ALTEGIO_BASE_URL = "https://api.alteg.io/api/v1";

function getPartnerToken(): string {
  return process.env.ALTEGIO_PARTNER_TOKEN || "";
}

function getUserToken(): string {
  return process.env.ALTEGIO_USER_TOKEN || "";
}

function getAuthHeaders(): Record<string, string> {
  const partner = getPartnerToken();
  const user = getUserToken();
  if (!partner) throw new Error("ALTEGIO_PARTNER_TOKEN not set. Configure it in .env.local");
  // Altegio uses a combined Authorization header: "Bearer {partner}, User {user}"
  const auth = user ? `Bearer ${partner}, User ${user}` : `Bearer ${partner}`;
  return {
    "Content-Type": "application/json",
    "Authorization": auth,
  };
}

async function altegioFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const headers = getAuthHeaders();
  const res = await fetch(`${ALTEGIO_BASE_URL}${path}`, {
    ...opts,
    headers: { ...headers, ...opts.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Altegio API ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

// ── Company / Business Info ──

export async function getCompanyInfo(companyId: number): Promise<any> {
  return altegioFetch(`/company/${companyId}`);
}

export async function getCompanies(): Promise<any> {
  return altegioFetch(`/companies`);
}

// ── Bookings / Appointments ──

export async function getBookings(companyId: number, params: {
  dateFrom?: string;  // YYYY-MM-DD
  dateTo?: string;    // YYYY-MM-DD
  staffId?: number;
  page?: number;
  count?: number;     // per page (max 200)
} = {}): Promise<any> {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set("date_from", params.dateFrom);
  if (params.dateTo) query.set("date_to", params.dateTo);
  if (params.staffId) query.set("staff_id", String(params.staffId));
  if (params.page) query.set("page", String(params.page));
  if (params.count) query.set("count", String(params.count));
  const qs = query.toString();
  return altegioFetch(`/bookings/${companyId}${qs ? `?${qs}` : ""}`);
}

export async function getBooking(companyId: number, bookingId: number): Promise<any> {
  return altegioFetch(`/bookings/${companyId}/${bookingId}`);
}

export async function createBooking(companyId: number, data: {
  staff_id: number;
  services: number[];
  datetime: string;  // ISO 8601
  person?: { name: string; phone: string; email?: string };
  comment?: string;
  api_id?: string;
}): Promise<any> {
  return altegioFetch(`/bookings/${companyId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateBooking(companyId: number, bookingId: number, data: {
  staff_id?: number;
  datetime?: string;
  services?: number[];
  comment?: string;
}): Promise<any> {
  return altegioFetch(`/bookings/${companyId}/${bookingId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteBooking(companyId: number, bookingId: number): Promise<any> {
  return altegioFetch(`/bookings/${companyId}/${bookingId}`, {
    method: "DELETE",
  });
}

// ── Staff / Specialists ──

export async function getStaff(companyId: number): Promise<any> {
  return altegioFetch(`/staff/${companyId}`);
}

export async function getStaffMember(companyId: number, staffId: number): Promise<any> {
  return altegioFetch(`/staff/${companyId}/${staffId}`);
}

// ── Services ──

export async function getServices(companyId: number): Promise<any> {
  return altegioFetch(`/services/${companyId}`);
}

export async function getService(companyId: number, serviceId: number): Promise<any> {
  return altegioFetch(`/services/${companyId}/${serviceId}`);
}

// ── Clients / Customers ──

export async function getClients(companyId: number, params: {
  page?: number;
  count?: number;
  search?: string;
} = {}): Promise<any> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.count) query.set("count", String(params.count));
  if (params.search) query.set("search", params.search);
  const qs = query.toString();
  return altegioFetch(`/clients/${companyId}${qs ? `?${qs}` : ""}`);
}

export async function getClient(companyId: number, clientId: number): Promise<any> {
  return altegioFetch(`/clients/${companyId}/${clientId}`);
}

export async function createClient(companyId: number, data: {
  name: string;
  phone: string;
  email?: string;
  comment?: string;
}): Promise<any> {
  return altegioFetch(`/clients/${companyId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Schedule / Availability ──

export async function getSchedule(companyId: number, params: {
  dateFrom: string;  // YYYY-MM-DD
  dateTo: string;      // YYYY-MM-DD
  staffId?: number;
}): Promise<any> {
  const query = new URLSearchParams();
  query.set("date_from", params.dateFrom);
  query.set("date_to", params.dateTo);
  if (params.staffId) query.set("staff_id", String(params.staffId));
  return altegioFetch(`/schedule/${companyId}?${query.toString()}`);
}

export async function getAvailableSlots(companyId: number, params: {
  serviceId: number;
  staffId?: number;
  date: string;  // YYYY-MM-DD
}): Promise<any> {
  const query = new URLSearchParams();
  query.set("service_id", String(params.serviceId));
  if (params.staffId) query.set("staff_id", String(params.staffId));
  query.set("date", params.date);
  return altegioFetch(`/slots/${companyId}?${query.toString()}`);
}

// ── Finance / Transactions ──

export async function getTransactions(companyId: number, params: {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  count?: number;
} = {}): Promise<any> {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set("date_from", params.dateFrom);
  if (params.dateTo) query.set("date_to", params.dateTo);
  if (params.page) query.set("page", String(params.page));
  if (params.count) query.set("count", String(params.count));
  const qs = query.toString();
  return altegioFetch(`/transactions/${companyId}${qs ? `?${qs}` : ""}`);
}

// ── Auth (get user token) ──

export async function authenticateUser(login: string, password: string): Promise<any> {
  const partner = getPartnerToken();
  if (!partner) throw new Error("ALTEGIO_PARTNER_TOKEN not set");
  const res = await fetch(`${ALTEGIO_BASE_URL}/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${partner}`,
    },
    body: JSON.stringify({ login, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Auth failed ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

// ── Default company ID for BIG ──
// From the Altegio URL: app.alteg.io/timetable/1355904
export const DEFAULT_COMPANY_ID = 1355904;