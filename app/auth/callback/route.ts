import { handleAdminAuthCallback } from "../../../lib/auth-callback";

export async function GET(request: Request) {
  return handleAdminAuthCallback(request);
}
