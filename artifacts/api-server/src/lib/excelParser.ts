import xlsx from "xlsx";
import path from "path";
import { existsSync } from "fs";

// Resolve data file path for both dev (ESM, run from artifacts/api-server/) and
// production (CJS bundle, run from workspace root via `node artifacts/api-server/dist/index.cjs`)
function resolveDataFile(): string {
  const candidates = [
    path.join(process.cwd(), "src/data/quoting_data.xlsx"),
    path.join(process.cwd(), "artifacts/api-server/src/data/quoting_data.xlsx"),
    path.join(process.cwd(), "data/quoting_data.xlsx"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const DATA_FILE = resolveDataFile();

export interface AssetRecord {
  serialNumber: string;
  assetName: string;
  accountName: string;
  facilityName: string;
  serviceTerritory: string;
  primaryTechnician: string;
  contractNumber: string;
  contractType: string;
  contractStatus: string;
  productName: string;
  contactName: string;
  contactEmail: string;
  street: string;
  city: string;
  stateZip: string;
  region: string;
}

export interface PartRecord {
  partName: string;
  partNumber: string;
  listPrice: number;
  netPrice: number;
  category: string;
}

let _workbook: xlsx.WorkBook | null = null;
let _assets: AssetRecord[] | null = null;
let _parts: PartRecord[] | null = null;

function getWorkbook(): xlsx.WorkBook {
  if (!_workbook) {
    _workbook = xlsx.readFile(DATA_FILE);
  }
  return _workbook;
}

export function getAssets(): AssetRecord[] {
  if (_assets) return _assets;

  const wb = getWorkbook();
  const sheet = wb.Sheets["Asset Data"];
  if (!sheet) return [];

  const rows = xlsx.utils.sheet_to_json<Record<string, string>>(sheet, {
    header: 1,
    raw: false,
  }) as string[][];

  // Row 0 is header
  // Col mapping based on actual headers found:
  // A=Region, B=Country, C=Asset Name(serial), D=Account Name, E=shortened facility name,
  // F=Service Territory, G=Primary Technician, H=Primary FAS, I=Account Owner,
  // J=Contract Number, K=Contract Type, L=Contract Status, M=Product Name,
  // N=Contact Name, O=Contact Email, P=Special Handling, Q=Street, R=City, S=State/Zip, U=Installed Address

  _assets = rows
    .slice(1)
    .filter((row) => row[2] && String(row[2]).trim())
    .map((row) => ({
      serialNumber: String(row[2] || "").trim(),
      assetName: String(row[2] || "").trim(),
      accountName: String(row[3] || "").trim(),
      facilityName: String(row[4] || "").trim(),
      serviceTerritory: String(row[5] || "").trim(),
      primaryTechnician: String(row[6] || row[7] || "").trim(),
      contractNumber: String(row[9] || "").trim(),
      contractType: String(row[10] || "").trim(),
      contractStatus: String(row[11] || "").trim(),
      productName: String(row[12] || "").trim(),
      contactName: String(row[13] || "").trim(),
      contactEmail: String(row[14] || "").trim(),
      street: String(row[16] || "").trim(),
      city: String(row[17] || "").trim(),
      stateZip: String(row[18] || "").trim(),
      region: String(row[0] || "").trim(),
    }));

  return _assets;
}

export function lookupAssetBySerial(serial: string): AssetRecord | null {
  const assets = getAssets();
  const normalized = serial.trim().toLowerCase();
  return (
    assets.find((a) => a.serialNumber.toLowerCase() === normalized) || null
  );
}

export function getAllSerials(): string[] {
  return getAssets()
    .map((a) => a.serialNumber)
    .filter(Boolean)
    .sort();
}

export function getParts(): PartRecord[] {
  if (_parts) return _parts;

  const wb = getWorkbook();
  const sheet = wb.Sheets["Pricing Data"];
  if (!sheet) return [];

  const rows = xlsx.utils.sheet_to_json<Record<string, string>>(sheet, {
    header: 1,
    raw: false,
  }) as string[][];

  // Headers: A=Display Name, B=Last Purchase Price, C=Sale Unit, D=Unit Price,
  // E=Price Level, F=Currency, G=Part Number, H=Item Internal ID

  _parts = rows
    .slice(1)
    .filter((row) => row[0] && String(row[0]).trim() && row[3])
    .map((row) => ({
      partName: String(row[0] || "").trim(),
      partNumber: String(row[6] || "").trim(),
      listPrice: parseFloat(String(row[3] || "0")) || 0,
      netPrice: parseFloat(String(row[1] || row[3] || "0")) || 0,
      category: String(row[4] || "Parts").trim(),
    }))
    .filter((p) => p.partName && p.listPrice > 0);

  return _parts;
}
