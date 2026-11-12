import { NextResponse, type NextRequest } from "next/server";

// Gli script hanno un nonce nuovo a ogni pagina: uno script iniettato non lo conosce e non parte.
// Gli stili restano in linea perché i grafici e la planimetria si posizionano con l'attributo style.
function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    // npm run dev ha bisogno di eval, il sito compilato no
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Controllo rapido: c'è un cookie di sessione? Non lo verifica.
// La verifica vera avviene in ogni pagina, API e azione con requireUser()/requireAdmin().
// /api/avvisi si autentica con il token del PC, avvisi-windows.ps1 non contiene segreti.
// Senza sessione: /stato e /api/salute sono pubbliche, /api/v1 si autentica con la chiave API.
const isPublic = (pathname: string) =>
  pathname === "/login" || pathname === "/stato" || pathname === "/api/salute" || pathname.startsWith("/api/v1/");

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!isPublic(pathname) && !request.cookies.has("vigil_sessione")) {
    if (isApi) return NextResponse.json({ error: "Sessione scaduta" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (isApi) return NextResponse.next();

  const policy = contentSecurityPolicy(btoa(crypto.randomUUID()));
  const headers = new Headers(request.headers);
  // Next legge il nonce da qui e lo mette sui suoi script
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!api/avvisi|avvisi-windows.ps1|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
