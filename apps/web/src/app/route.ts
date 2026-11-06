/** No website: the root only names the service. The chat lives in the SV KI-Lotse Mac app. */
export function GET(): Response {
  return new Response(
    "SV KI-Lotse API. Die Anwendung wird über die SV KI-Lotse Mac-App genutzt.\n",
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
