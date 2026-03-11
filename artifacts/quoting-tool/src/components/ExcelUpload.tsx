import React, { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ChevronRight,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ParsedPartItem {
  name: string;
  partNumber: string;
  price: number;
  quantity: number;
}

export interface ParsedQuoteSection {
  customerName: string;
  serialNumber: string;
  facilityName: string;
  shortFacility: string;
  address: string;
  contractType: string;
  parts: ParsedPartItem[];
}

export interface ParsedUploadResult {
  quoteType: string;
  serviceQuote: ParsedQuoteSection;
  partsQuote: ParsedQuoteSection;
  sheets: string[];
}

interface ExcelUploadProps {
  onParsed: (result: ParsedUploadResult) => void;
  onSkip: () => void;
}

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function ExcelUpload({ onParsed, onSkip }: ExcelUploadProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [fileName, setFileName] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [result, setResult] = useState<ParsedUploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.match(/\.(xlsx|xls)$/i)) {
        setState("error");
        setErrorMsg("Please upload an Excel file (.xlsx or .xls)");
        return;
      }

      setFileName(file.name);
      setState("uploading");
      setErrorMsg("");

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`${BASE_URL}/api/quotes/parse-upload`, {
          method: "POST",
          body: formData,
        });

        const json = await res.json();

        if (!res.ok) {
          setState("error");
          setErrorMsg(json.error || "Failed to parse the Excel file.");
          return;
        }

        setResult(json as ParsedUploadResult);
        setState("success");
      } catch (err: unknown) {
        setState("error");
        setErrorMsg("Network error. Please try again.");
      }
    },
    []
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setState("idle");
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const reset = () => {
    setState("idle");
    setFileName("");
    setErrorMsg("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const quoteTypeBadge = (qt: string) => {
    if (qt.toLowerCase().includes("service and parts"))
      return { label: "Service & Parts Quote", color: "bg-blue-100 text-blue-800" };
    if (qt.toLowerCase().includes("parts"))
      return { label: "Parts Only Quote", color: "bg-purple-100 text-purple-800" };
    return { label: "Service Quote", color: "bg-emerald-100 text-emerald-800" };
  };

  return (
    <div className="max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {state === "success" && result ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-card rounded-2xl border border-border shadow-xl shadow-slate-200/50 overflow-hidden"
          >
            <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-emerald-900">
                  Excel file processed successfully
                </h3>
                <p className="text-sm text-emerald-700 truncate">{fileName}</p>
              </div>
              <button
                onClick={reset}
                className="p-2 rounded-lg hover:bg-emerald-100 text-emerald-600 transition-colors flex-shrink-0"
                title="Upload a different file"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold",
                    quoteTypeBadge(result.quoteType).color
                  )}
                >
                  {quoteTypeBadge(result.quoteType).label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {result.sheets.length} sheets found
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {result.serviceQuote.serialNumber && (
                  <SectionCard
                    title="Service Quote"
                    icon="service"
                    section={result.serviceQuote}
                  />
                )}
                {result.partsQuote.serialNumber && (
                  <SectionCard
                    title="Parts Quote"
                    icon="parts"
                    section={result.partsQuote}
                  />
                )}
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => onParsed(result)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-primary to-blue-500 text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
                >
                  Populate Form with This Data
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={reset}
                  className="sm:w-auto flex items-center justify-center gap-2 py-3 px-5 rounded-xl font-semibold text-sm border border-border text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Upload Different File
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-card rounded-2xl border border-border shadow-xl shadow-slate-200/50 overflow-hidden"
          >
            <div className="px-6 py-5 border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    Upload Your FSE Excel File
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Upload your filled-out Cytek Quoting Tool spreadsheet to auto-populate all fields
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setState("dragging");
                }}
                onDragLeave={() => setState("idle")}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "relative flex flex-col items-center justify-center min-h-[220px] rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 group",
                  state === "dragging"
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : state === "uploading"
                    ? "border-blue-300 bg-blue-50/50 cursor-wait"
                    : state === "error"
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-slate-200 bg-slate-50/50 hover:border-primary/50 hover:bg-primary/5"
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={onFileChange}
                />

                <AnimatePresence mode="wait">
                  {state === "uploading" ? (
                    <motion.div
                      key="uploading"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="flex flex-col items-center gap-3 text-center px-6"
                    >
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                      <p className="text-base font-semibold text-slate-700">
                        Processing Excel file...
                      </p>
                      <p className="text-sm text-muted-foreground truncate max-w-xs">
                        {fileName}
                      </p>
                    </motion.div>
                  ) : state === "error" ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="flex flex-col items-center gap-3 text-center px-6"
                    >
                      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-destructive" />
                      </div>
                      <p className="text-base font-semibold text-destructive">
                        Upload Failed
                      </p>
                      <p className="text-sm text-slate-600 max-w-sm">{errorMsg}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Click to try again
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="flex flex-col items-center gap-4 text-center px-6"
                    >
                      <div
                        className={cn(
                          "w-16 h-16 rounded-2xl flex items-center justify-center transition-colors",
                          state === "dragging"
                            ? "bg-primary/20 text-primary"
                            : "bg-slate-100 text-slate-400 group-hover:bg-primary/10 group-hover:text-primary"
                        )}
                      >
                        <Upload className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-slate-700 group-hover:text-primary transition-colors">
                          {state === "dragging"
                            ? "Drop your file here"
                            : "Drag & drop your Excel file"}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          or{" "}
                          <span className="text-primary font-medium underline underline-offset-2">
                            browse to upload
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                        Supports .xlsx and .xls files — reads FSE Input tab automatically
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-4 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium">OR</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <button
                onClick={onSkip}
                className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-semibold text-sm border border-border text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Fill in the form manually instead
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  section,
}: {
  title: string;
  icon: "service" | "parts";
  section: ParsedQuoteSection;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold",
            icon === "service" ? "bg-primary" : "bg-purple-500"
          )}
        >
          {icon === "service" ? "S" : "P"}
        </div>
        <span className="text-sm font-bold text-slate-700">{title}</span>
      </div>
      <InfoRow label="Customer" value={section.customerName} />
      <InfoRow label="Serial" value={section.serialNumber} mono />
      <InfoRow label="Facility" value={section.facilityName} />
      <InfoRow label="Contract" value={section.contractType} />
      <InfoRow
        label="Parts"
        value={
          section.parts.length > 0
            ? `${section.parts.length} item${section.parts.length !== 1 ? "s" : ""}`
            : "None"
        }
      />
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-semibold text-slate-500 w-16 flex-shrink-0">
        {label}
      </span>
      <span
        className={cn(
          "text-xs text-slate-800 truncate",
          mono && "font-mono font-medium text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}
