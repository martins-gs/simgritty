import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image
     * - favicon, images
     *
     * API routes ARE included so that Supabase auth tokens get
     * refreshed before Route Handlers run — otherwise long-lived
     * sessions (e.g. simulations) fail with 401 once the access
     * token expires.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
