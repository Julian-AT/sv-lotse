/** Legacy URLs are aliases only; all admission and scope checks live in relatives. */
export async function inviteResponse(
  request: Request,
  action: "create" | "accept" | "approve" | "list" | "control" | "status",
): Promise<Response> {
  const paths = {
    create: "/api/relatives/invites",
    accept: "/api/relatives/join",
    approve: "/api/relatives/session",
    list: "/api/relatives/sessions",
    control: "/api/relatives/session",
    status: "/api/relatives/session",
  };
  const source = new URL(request.url);
  const target = new URL(paths[action], source);
  const caseId = source.searchParams.get("caseId");
  const joinId = source.searchParams.get("joinId");
  if (caseId) target.searchParams.set("caseId", caseId);
  if (joinId) target.searchParams.set("id", joinId);
  return new Response(null, {
    status: 307,
    headers: {
      Location: target.toString(),
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
