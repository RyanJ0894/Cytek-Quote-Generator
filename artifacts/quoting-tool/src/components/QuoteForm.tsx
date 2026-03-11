import React, { useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Building2, User, MapPin, Search, 
  Settings2, Plus, Trash2, FileText, 
  FileBox, Info, Calculator, Loader2, ChevronDown
} from "lucide-react";

import { cn, formatCurrency } from "@/lib/utils";
import { Autocomplete } from "./Autocomplete";
import { useToast } from "@/hooks/use-toast";

// Assuming we import these from the generated workspace package
import { 
  useListSerials, 
  useLookupAsset, 
  useListParts, 
  useGenerateQuote,
  type QuoteRequest,
  type PartItem
} from "@workspace/api-client-react";

const quoteLineItemSchema = z.object({
  description: z.string().min(1, "Part description is required"),
  partNumber: z.string().optional(),
  quantity: z.coerce.number().min(1, "Must be at least 1"),
  unitPrice: z.coerce.number().min(0, "Invalid price")
});

const quoteFormSchema = z.object({
  customerName: z.string().min(1, "Customer name is required"),
  serialNumber: z.string().min(1, "Serial number is required"),
  accountName: z.string().optional(),
  facilityName: z.string().optional(),
  address: z.string().optional(),
  contractType: z.string().optional(),
  contractStatus: z.string().optional(),
  productName: z.string().optional(),
  
  serviceType: z.string().optional(),
  servicePrice: z.coerce.number().min(0).optional(),
  
  parts: z.array(quoteLineItemSchema),
  
  shippingAndHandling: z.coerce.number().min(0).default(0),
  notes: z.string().optional()
});

type QuoteFormValues = z.infer<typeof quoteFormSchema>;

const SERVICE_TYPES = [
  "On-Site Support (1 day)",
  "On-Site Support (2 days)",
  "PM Service",
  "Remote Support",
  "Other"
];

export function QuoteForm() {
  const { toast } = useToast();
  
  // Data Fetching
  const { data: serialsData, isLoading: isLoadingSerials } = useListSerials();
  const { data: partsData, isLoading: isLoadingParts } = useListParts();
  
  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: {
      customerName: "",
      serialNumber: "",
      accountName: "",
      facilityName: "",
      address: "",
      contractType: "",
      contractStatus: "",
      productName: "",
      serviceType: "",
      servicePrice: 0,
      parts: [],
      shippingAndHandling: 0,
      notes: ""
    }
  });

  const { control, handleSubmit, watch, setValue, register, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "parts" });

  const serialNumber = watch("serialNumber");
  
  // Conditionally fetch asset data when a serial number is provided
  const { data: assetData, isFetching: isFetchingAsset } = useLookupAsset(
    { serial: serialNumber },
    { query: { enabled: !!serialNumber && serialNumber.length > 2, retry: false } }
  );

  // Auto-fill form when asset data is loaded
  useEffect(() => {
    if (assetData?.asset) {
      const asset = assetData.asset;
      if (asset.accountName) setValue("accountName", asset.accountName, { shouldValidate: true });
      if (asset.facilityName) setValue("facilityName", asset.facilityName);
      
      const fullAddress = [asset.street, asset.city, asset.stateZip].filter(Boolean).join(", ");
      if (fullAddress) setValue("address", fullAddress);
      
      if (asset.contractType) setValue("contractType", asset.contractType);
      if (asset.contractStatus) setValue("contractStatus", asset.contractStatus);
      if (asset.productName) setValue("productName", asset.productName);
      
      toast({
        title: "Asset found",
        description: `Loaded data for ${asset.assetName || serialNumber}`,
      });
    }
  }, [assetData, setValue, serialNumber, toast]);

  const generateMutation = useGenerateQuote({
    mutation: {
      onSuccess: (blob) => {
        // Create a blob URL and trigger download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const custName = watch("customerName").replace(/[^a-z0-9]/gi, '_');
        const serial = watch("serialNumber");
        a.download = `Quote_${custName}_${serial}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        toast({
          title: "Quote Generated",
          description: "Your PDF quote has been downloaded successfully.",
        });
      },
      onError: (err: any) => {
        toast({
          variant: "destructive",
          title: "Failed to generate quote",
          description: err.message || "An unexpected error occurred.",
        });
      }
    }
  });

  const onSubmit = (data: QuoteFormValues) => {
    const payload: QuoteRequest = {
      customerName: data.customerName,
      accountName: data.accountName,
      facilityName: data.facilityName,
      address: data.address,
      serialNumber: data.serialNumber,
      contractType: data.contractType,
      serviceType: data.serviceType,
      servicePrice: data.servicePrice,
      parts: data.parts.map(p => ({
        description: p.description,
        partNumber: p.partNumber,
        quantity: p.quantity,
        unitPrice: p.unitPrice
      })),
      notes: data.notes
    };
    generateMutation.mutate({ data: payload });
  };

  // Calculations
  const parts = watch("parts");
  const servicePrice = watch("servicePrice") || 0;
  const sh = watch("shippingAndHandling") || 0;
  
  const partsTotal = parts.reduce((acc, part) => {
    const qty = Number(part.quantity) || 0;
    const price = Number(part.unitPrice) || 0;
    return acc + (qty * price);
  }, 0);
  
  const subtotal = servicePrice + partsTotal;
  const total = subtotal + sh;

  // Render Helpers
  const ErrorMsg = ({ field }: { field: string }) => {
    // Basic nested error resolution
    const error = field.split('.').reduce((obj: any, key) => obj?.[key], errors);
    if (!error) return null;
    return <p className="text-destructive text-xs mt-1 font-medium">{error.message}</p>;
  };

  const InputLabel = ({ children, icon: Icon, required }: { children: React.ReactNode, icon?: any, required?: boolean }) => (
    <label className="flex items-center text-sm font-semibold text-slate-700 mb-1.5">
      {Icon && <Icon className="w-4 h-4 mr-2 text-primary/70" />}
      {children} {required && <span className="text-destructive ml-1">*</span>}
    </label>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 pb-20">
      
      {/* 1. CUSTOMER INFORMATION */}
      <section className="bg-card rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-border">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/60">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl">Customer Information</h2>
            <p className="text-sm text-muted-foreground">Details populated automatically from serial lookup</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <InputLabel icon={User} required>Customer Name</InputLabel>
            <input 
              {...register("customerName")} 
              className={cn(
                "w-full px-4 py-2.5 rounded-xl border bg-slate-50/50 focus:bg-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20",
                errors.customerName ? "border-destructive focus:border-destructive" : "border-input focus:border-primary"
              )}
              placeholder="e.g. John Doe"
            />
            <ErrorMsg field="customerName" />
          </div>

          <div>
            <InputLabel icon={Search} required>Serial Number</InputLabel>
            <Autocomplete
              items={serialsData?.serials || []}
              value={watch("serialNumber")}
              onChange={(val) => setValue("serialNumber", val, { shouldValidate: true })}
              getDisplayValue={(item: string) => item}
              placeholder="Type or select serial..."
              disabled={isLoadingSerials}
              icon={isFetchingAsset ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Search className="w-4 h-4 text-muted-foreground" />}
            />
            <ErrorMsg field="serialNumber" />
          </div>

          <div>
            <InputLabel icon={Building2}>Account Name</InputLabel>
            <input 
              {...register("accountName")} 
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-slate-50/50 focus:bg-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <InputLabel icon={Building2}>Facility Name</InputLabel>
            <input 
              {...register("facilityName")} 
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-slate-50/50 focus:bg-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="md:col-span-2">
            <InputLabel icon={MapPin}>Address</InputLabel>
            <input 
              {...register("address")} 
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-slate-50/50 focus:bg-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Read-only info badges from Asset Lookup */}
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Contract Type</span>
              <span className="text-sm font-medium text-slate-900">{watch("contractType") || "—"}</span>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Status</span>
              <span className="text-sm font-medium text-slate-900">
                {watch("contractStatus") ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                    {watch("contractStatus")}
                  </span>
                ) : "—"}
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Instrument</span>
              <span className="text-sm font-medium text-slate-900">{watch("productName") || "—"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. SERVICE QUOTE */}
      <section className="bg-card rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-border">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/60">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Settings2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl">Service Quote</h2>
            <p className="text-sm text-muted-foreground">Select primary service offering</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <InputLabel>Service Type</InputLabel>
            <div className="relative">
              <select 
                {...register("serviceType")}
                className="w-full pl-4 pr-10 py-2.5 appearance-none rounded-xl border border-input bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">Select a service...</option>
                {SERVICE_TYPES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div>
            <InputLabel>Service Price ($)</InputLabel>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 text-sm font-medium">$</span>
              <input 
                type="number" 
                step="0.01"
                {...register("servicePrice")} 
                className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-input bg-slate-50/50 focus:bg-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <ErrorMsg field="servicePrice" />
          </div>
        </div>
      </section>

      {/* 3. PARTS QUOTE */}
      <section className="bg-card rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-border">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <FileBox className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl">Parts Configuration</h2>
              <p className="text-sm text-muted-foreground">Add components and replacement parts</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => append({ description: "", partNumber: "", quantity: 1, unitPrice: 0 })}
            className="flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground shadow hover:bg-primary/90 hover:shadow-md transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add Part
          </button>
        </div>

        <div className="space-y-4">
          {fields.length === 0 && (
            <div className="py-8 text-center flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <FileBox className="w-12 h-12 text-slate-300 mb-3" />
              <h3 className="text-sm font-medium text-slate-600 mb-1">No parts added</h3>
              <p className="text-xs text-slate-500 mb-4">Click "Add Part" to include components in this quote.</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {fields.map((field, index) => {
              const qty = watch(`parts.${index}.quantity`) || 0;
              const price = watch(`parts.${index}.unitPrice`) || 0;
              const extPrice = qty * price;

              return (
                <motion.div
                  key={field.id}
                  initial={{ opacity: 0, height: 0, scale: 0.95 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start p-4 bg-slate-50 border border-slate-200 rounded-xl group relative overflow-hidden"
                >
                  <div className="lg:col-span-4">
                    <InputLabel required>Part Description</InputLabel>
                    <Autocomplete
                      items={partsData?.parts || []}
                      value={watch(`parts.${index}.description`)}
                      onChange={(val) => setValue(`parts.${index}.description`, val, { shouldValidate: true })}
                      onSelect={(item: PartItem) => {
                        setValue(`parts.${index}.partNumber`, item.partNumber || "");
                        setValue(`parts.${index}.unitPrice`, item.listPrice || 0);
                      }}
                      getDisplayValue={(item: PartItem) => item.partName}
                      getSearchValue={(item: PartItem) => `${item.partName} ${item.partNumber || ""}`}
                      placeholder="Search parts catalog..."
                      disabled={isLoadingParts}
                      icon={<FileBox className="w-4 h-4 text-muted-foreground" />}
                    />
                    <ErrorMsg field={`parts.${index}.description`} />
                  </div>

                  <div className="lg:col-span-2">
                    <InputLabel>Part Number</InputLabel>
                    <input 
                      {...register(`parts.${index}.partNumber`)} 
                      className="w-full px-3 py-2.5 rounded-lg border border-input bg-white text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      placeholder="e.g. PN-123"
                    />
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-5 lg:col-span-5 gap-4">
                    <div className="col-span-1 lg:col-span-2">
                      <InputLabel required>Qty</InputLabel>
                      <input 
                        type="number" 
                        {...register(`parts.${index}.quantity`)} 
                        className="w-full px-3 py-2.5 rounded-lg border border-input bg-white text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                      <ErrorMsg field={`parts.${index}.quantity`} />
                    </div>

                    <div className="col-span-1 lg:col-span-3">
                      <InputLabel required>Unit Price</InputLabel>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          {...register(`parts.${index}.unitPrice`)} 
                          className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-input bg-white text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <ErrorMsg field={`parts.${index}.unitPrice`} />
                    </div>
                  </div>

                  <div className="lg:col-span-1 flex items-center justify-between lg:justify-end h-full pt-6 lg:pt-0">
                    <div className="lg:hidden text-sm font-semibold text-slate-600">
                      Ext: {formatCurrency(extPrice)}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="p-2 text-slate-400 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      title="Remove Part"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {/* Subtle extended price indicator on large screens */}
                  <div className="hidden lg:block absolute right-14 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-600 px-3 py-1 bg-white border border-slate-200 rounded-md shadow-sm">
                    {formatCurrency(extPrice)}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* 4. NOTES */}
        <section className="lg:col-span-7 bg-card rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-border h-full">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border/60">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="text-xl">Additional Notes</h2>
          </div>
          <textarea
            {...register("notes")}
            rows={5}
            className="w-full p-4 rounded-xl border border-input bg-slate-50/50 focus:bg-white text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            placeholder="Add any specific notes, terms, or conditions to include on the PDF quote..."
          />
        </section>

        {/* 5. TOTALS */}
        <section className="lg:col-span-5 bg-slate-900 rounded-2xl p-1 shadow-xl shadow-slate-900/20 text-white relative overflow-hidden">
          {/* Decorative background element */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-primary/30 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="bg-slate-900/50 backdrop-blur-md rounded-[14px] p-6 h-full flex flex-col justify-between relative z-10">
            <div>
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                <Calculator className="w-5 h-5 text-primary-foreground" />
                <h2 className="text-xl text-white">Summary</h2>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center text-slate-300">
                  <span>Service Subtotal</span>
                  <span className="font-medium text-white">{formatCurrency(servicePrice)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Parts Subtotal</span>
                  <span className="font-medium text-white">{formatCurrency(partsTotal)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300 pt-2 border-t border-white/5">
                  <span>Subtotal</span>
                  <span className="font-medium text-white">{formatCurrency(subtotal)}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-slate-300">Shipping & Handling</span>
                  <div className="w-32 relative">
                    <span className="absolute left-3 top-2 text-slate-400 text-sm font-medium">$</span>
                    <input 
                      type="number" 
                      step="0.01"
                      {...register("shippingAndHandling")} 
                      className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-white/20 bg-white/5 text-white text-sm text-right focus:outline-none focus:border-primary focus:bg-white/10 transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-end pt-4 border-t border-white/10 mb-6">
                <span className="text-lg text-slate-300">Total Quote</span>
                <span className="text-4xl font-bold font-display text-white tracking-tight">
                  {formatCurrency(total)}
                </span>
              </div>

              <button
                type="submit"
                disabled={generateMutation.isPending}
                className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-primary to-blue-500 text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating PDF...
                  </>
                ) : (
                  <>
                    Generate Quote
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </form>
  );
}
