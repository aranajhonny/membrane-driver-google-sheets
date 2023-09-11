import { nodes, state, root } from "membrane";
import { ensureClient, api, html } from "./utils";

export const Root = {
  spreadsheets: () => ({}),
  configure: async ({ clientId, clientSecret, token }) => {
    state.endpointUrl = await nodes.endpoint.$get();
    state.clientId = clientId;
    state.clientSecret = clientSecret;
    // Token is optional, but it's convenient while working on this driver (and perhaps constantly killing it) to avoid
    // having to auth with Google over and over
    if (token) {
      // If restoring a token, assume it's expired so it gets refreshed right away
      const data = { ...JSON.parse(token), expires_in: 0 };
      state.accessToken = state.auth.createToken(null, null, null, data);
    }
    ensureClient();
  },
};

export const SpreadsheetCollection = {
  one: async ({ id }) => {
    const res = await api(
      "GET",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}`
    );
    const json = await res.json();
    return json;
  },
  async page(args, { self }) {
    const { q: query, ...rest } = args;
    const mimeType = "application/vnd.google-apps.spreadsheet";
    const queryStr = query ? `and ${query}` : "";
    const q = `mimeType='${mimeType}' ${queryStr}`;
    const res = await api("GET", "www.googleapis.com", "drive/v3/files", {
      ...rest,
      q,
    });
    const json = await res.json();
    return {
      items: json.files,
      next: self.page({ ...rest, pageToken: json.nextPageToken }),
    };
  },
};

export const Spreadsheet = {
  gref: (_, { obj }) => {
    return root.spreadsheets.one({ id: obj!.id });
  },
  id: (_, { obj }) => obj!.spreadsheetId ?? obj!.id,
  name: (_, { obj }) => obj!.name ?? obj.properties.title,
};

export const SheetCollection = {
  one: async ({ sheetId }, { obj }) => {
    return obj
      .map((sheet) => sheet.properties)
      .find((sheet) => sheet.sheetId === sheetId);
  },
  items: (_, { obj }) => obj.map((sheet) => sheet.properties),
};

export const Sheet = {
  gref: (_, { obj, self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const sheetId = obj.sheetId;

    return root.spreadsheets.one({ id }).sheets.one({ sheetId });
  },
  copyTo: async ({ spreadsheetId }, { obj, self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const sheetId = obj!.properties.sheetId;

    await api(
      "POST",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}/sheets/${sheetId}:copyTo`,
      {},
      JSON.stringify({
        destinationSpreadsheetId: spreadsheetId,
      })
    );
  },
  data: async ({ range }, { obj, self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const title = formatSheetName(obj.title);
    const cells = range || "A1:Z1000";
    const res = await api(
      "GET",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}/values/${title}!${cells}`
    );
    const data = await res.json();
    return data.values ? data.values : [];
  },
  dataCsv: async ({ range }, { obj, self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const title = formatSheetName(obj.title);
    const cells = range || "A1:Z1000";
    const res = await api(
      "GET",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}/values/${title}!${cells}`
    );
    const data = await res.json();
    return data.values
      ? data.values.map((row: string[]) => row.join(",")).join("\n")
      : "";
  },
  update: async ({ values, csv, range }, { self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const { sheetId } = self.$argsAt(root.spreadsheets.one.sheets.one);

    const { title } = await root.spreadsheets
      .one({ id })
      .sheets.one({ sheetId })
      .$query(`{ title}`);

    if (csv && values) {
      throw new Error("Only CSV or JSON values can be passed");
    }

    const data = csv
      ? csv.split("\n").map((row: string) => row.split(","))
      : values;

    await api(
      "PUT",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}/values/${formatSheetName(title)}!${range}`,
      {
        valueInputOption: "USER_ENTERED",
      },
      JSON.stringify({
        values: data,
      })
    );
  },
  append: async ({ values, csv, range }, { self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const { sheetId } = self.$argsAt(root.spreadsheets.one.sheets.one);
    const cells = range || "A1:Z1000";

    const { title } = await root.spreadsheets
      .one({ id })
      .sheets.one({ sheetId })
      .$query(`{ title}`);

    if (csv && values) {
      throw new Error("Only CSV or JSON values can be passed");
    }

    const data = csv
      ? csv.split("\n").map((row: string) => row.split(","))
      : values;

    await api(
      "POST",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}/values/${formatSheetName(title)}!${cells}:append`,
      {
        valueInputOption: "USER_ENTERED",
      },
      JSON.stringify({
        values: data,
      })
    );
  },
  clear: async ({ range }, { self }) => {
    const { id } = self.$argsAt(root.spreadsheets.one);
    const { sheetId } = self.$argsAt(root.spreadsheets.one.sheets.one);
    const cells = range || "A1:Z1000";

    const { title } = await root.spreadsheets
      .one({ id })
      .sheets.one({ sheetId })
      .$query(`{ title}`);

    await api(
      "POST",
      "sheets.googleapis.com",
      `v4/spreadsheets/${id}/values/${formatSheetName(title)}!${cells}:clear`
    );
  },
};

export async function endpoint({ path, query, headers, body }) {
  switch (path) {
    case "/": {
      return html(`<a href="/auth">Authenticate with Google</a>`);
    }
    case "/auth":
    case "/auth/": {
      ensureClient();
      const url = state.auth.code.getUri({
        query: { access_type: "offline", prompt: "consent" }, // Request refresh token
        // TODO: state
      });
      return JSON.stringify({ status: 303, headers: { location: url } });
    }
    case "/auth/callback": {
      state.accessToken = await state.auth.code.getToken(`${path}?${query}`);
      if (state.accessToken?.accessToken) {
        return html(`Driver configured!`);
      }
      return html(
        `There was an issue acquiring the access token. Check the logs.`
      );
    }
    default:
      console.log("Unknown Endpoint:", path);
  }
}

// Util for formatting sheet names to A1 notation
function formatSheetName(sheetName: any): string {
  if (/[\s\W]/.test(sheetName) || !/^[a-zA-Z0-9]+$/.test(sheetName)) {
    return `'${sheetName}'`;
  }
  return sheetName;
}
