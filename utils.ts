import { nodes, state, root } from "membrane";
import ClientOAuth2 from "client-oauth2";

export async function api(
  method: string,
  domain: string,
  path: string,
  query?: any,
  body?: string
) {
  if (!state.accessToken) {
    throw new Error(
      "You must authenticated to use this API. Visit the program's /auth endpoint"
    );
  }
  if (query) {
    Object.keys(query).forEach((key) =>
      query[key] === undefined ? delete query[key] : {}
    );
  }
  const querystr =
    query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";

  if (state.accessToken.expired()) {
    console.log("Refreshing access token...");
    state.accessToken = await state.accessToken.refresh();
  }

  const req = state.accessToken.sign({
    method,
    url: `https://${domain}/${path}${querystr}`,
    body,
  });
  return await fetch(req.url, req);
}

if (state.auth) {
  state.auth.request = oauthRequest;
}

async function oauthRequest(
  method: string,
  url: string,
  reqBody: string,
  headers: any
) {
  const res = await fetch(url, { body: reqBody.toString(), headers, method });
  const status = res.status;
  const body = await res.text();
  return { status, body };
}

export function ensureClient() {
  const { clientId, clientSecret } = state;
  if (!clientId || !clientSecret) {
    throw new Error(
      "You must configure the driver with a client ID and secret"
    );
  }

  state.auth = new ClientOAuth2(
    {
      clientId,
      clientSecret,
      accessTokenUri: "https://oauth2.googleapis.com/token",
      authorizationUri: "https://accounts.google.com/o/oauth2/v2/auth",
      redirectUri: `${state.endpointUrl}/auth/callback`,
      // The 'drive.readonly' scope is required to list Google Sheets files
      scopes: [
        "https://www.googleapis.com/auth/drive",
      ],
    },
    oauthRequest
  );
}

// Helper function to produce nicer HTML
export function html(body: string) {
  return `
      <!DOCTYPE html>
      <head>
        <title>Google Sheets Driver for Membrane</title>
        <link rel="stylesheet" href="https://unpkg.com/bootstrap@4.1.0/dist/css/bootstrap-reboot.css">
      </head>
      <body style="padding: 0px 15px">
        <p>
          <h1>Google Sheets Driver for Membrane</h1>
          ${body}
        </p>
      </body>
      `;
}
