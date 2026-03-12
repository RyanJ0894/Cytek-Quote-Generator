import React, { useState } from "react";
import { QuoteForm } from "@/components/QuoteForm";
import { ExcelUpload, type ParsedUploadResult } from "@/components/ExcelUpload";
import { Sparkles, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type AppStep = "upload" | "form";

export default function Home() {
  const [step, setStep] = useState<AppStep>("upload");
  const [parsedData, setParsedData] = useState<ParsedUploadResult | null>(null);

  const handleParsed = (result: ParsedUploadResult) => {
    setParsedData(result);
    setStep("form");
  };

  const handleSkip = () => {
    setParsedData(null);
    setStep("form");
  };

  const handleReset = () => {
    setParsedData(null);
    setStep("upload");
  };

  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-slate-50 to-slate-50">

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <img
              src="/cytek-logo.png"
              alt="Cytek Quote Generator"
              className="h-10 w-auto object-contain"
            />

            <div className="flex items-center gap-3">
              {step === "form" && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Upload New File
                </button>
              )}
              <div className="flex items-center gap-2 text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
                <Sparkles className="w-4 h-4 text-amber-500" />
                FSE Portal
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <AnimatePresence mode="wait">
          {step === "upload" ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.25 }}
            >
              <div className="mb-8 text-center">
                <h2 className="text-3xl font-bold text-slate-900 font-display mb-2">
                  Start with Your Excel File
                </h2>
                <p className="text-slate-500 max-w-xl mx-auto">
                  Upload your Cytek Quoting Tool spreadsheet — the app reads every tab and fills in all the fields automatically. You can edit anything before generating the PDF.
                </p>
              </div>
              <ExcelUpload onParsed={handleParsed} onSkip={handleSkip} />
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.25 }}
            >
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-3xl font-bold text-slate-900 font-display">
                    {parsedData ? "Review & Edit Quote" : "Create New Quote"}
                  </h2>
                  {parsedData && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      ✓ Populated from Excel
                    </span>
                  )}
                </div>
                <p className="text-slate-500">
                  {parsedData
                    ? "All fields have been filled from your spreadsheet. Review and edit as needed, then generate your PDF."
                    : "Fill in customer and service details, then generate a PDF quote."}
                </p>
              </div>

              <QuoteForm parsedData={parsedData} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

