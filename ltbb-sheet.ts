import type { OAuth2Client } from "google-auth-library";
import { getServices } from "./google";

export const LTBB_SPREADSHEET_ID = "1NpooK5pUnErbCm3R9apKizRrrzNuSVTNgWRFcfmP6wo";
export const LTBB_TAB = "Partneriai 2026";

export type SheetPartner = {
  rowIndex: number;   // 1-based sheet row, for future write-back
  category: string;
  company: string;
  email: string;
  status: string;     // Sutiko · Laukiama atsakymo · Nenori · Derimasi · Nesusiekta · ""
  pastaba: string;
  nextStep: string;   // Kitas žingsnis column
};

const isCategoryRow = (row: string[]): boolean => {
  const a = (row[0] ?? "").trim();
  const b = (row[1] ?? "").trim();
  return a.length > 0 && b.length === 0;
};

export const readPartnersSheet = async (
  client: OAuth2Client,
): Promise<SheetPartner[]> => {
  const { sheets } = getServices(client);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: LTBB_SPREADSHEET_ID,
    range: `'${LTBB_TAB}'!A1:J200`,
  });
  const rows = (res.data.values ?? []) as string[][];
  if (rows.length < 2) return [];

  let category = "";
  const out: SheetPartner[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    if (isCategoryRow(r)) {
      category = (r[0] ?? "").trim();
      continue;
    }
    const company = (r[1] ?? "").trim();
    if (!company) continue;
    out.push({
      rowIndex: i + 1,
      category,
      company,
      email: (r[6] ?? "").trim(),
      status: (r[7] ?? "").trim(),
      pastaba: (r[8] ?? "").trim(),
      nextStep: (r[9] ?? "").trim(),
    });
  }
  return out;
};
