import React, { useEffect, useMemo, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Building2, User, MapPin, Search, 
  Settings2, Plus, Trash2, FileText, 
  FileBox, Calculator, Loader2, AlertTriangle
} from "lucide-react";
import { Link } from "wouter";

import { cn, formatCurrency } from "@/lib/utils";
import { Autocomplete } from "./Autocomplete";
import { useToast } from "@/hooks/use-toast";

import { 
  useListSerials, 
  getListSerialsQueryKey,
  useLookupAsset, 
  getLookupAssetQueryKey,
  useListParts, 
  getListPartsQueryKey,
  useGenerateQuote,
  type DataSourceSummary,
  type QuoteRequest,
  type PartItem
} from "@workspace/api-client-react";

const quoteLineItemSchema = z.object({
  description: z.string().min(1, "Part description is required"),
  partNumber: z.string().optional(),
  quantity: z.coerce.number().min(1, "Must be at least 1"),
  unitPrice: z.coerce.number().min(0, "Invalid price"),
  discountPercent: z.coerce.number().min(0, "0-100").max(100, "0-100").default(0),
});

const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** Selling price per unit after a quote-specific percentage discount. Blank/0 keeps the list price. */
export function applyDiscount(unitPrice: unknown, discountPercent: unknown): number {
  const price = Number(unitPrice) || 0;
  const pct = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return roundMoney(price * (1 - pct / 100));
}

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
  serviceDiscountPercent: z.coerce.number().min(0, "0-100").max(100, "0-100").default(0),
  
  parts: z.array(quoteLineItemSchema),
  
  shippingAndHandling: z.coerce.number().min(0).default(0),
  notes: z.string().optional()
});

type QuoteFormValues = z.infer<typeof quoteFormSchema>;

/** The seeded Cytek source; the only one that still gets the legacy service labels below. */
const CYTEK_SEED_ID = "cytek";

/**
 * Service labels that predate the data-driven service list. They have no
 * catalog price, so selecting one sets the price to 0 for manual entry.
 * Kept for the Cytek source only, so existing users can still pick the
 * wording they are used to; every other source shows its own catalog only.
 */
const LEGACY_SERVICE_TYPES = [
  "On-Site Support (1 day)",
  "PM Service",
  "Remote Support",
];

interface QuoteFormProps {
  /** The Data Source every lookup in this form is scoped to. */
  dataSourceId: string;
  sources: DataSourceSummary[];
  /** Called when the user confirms switching to another Data Source (the page remounts the form). */
  onSwitch: (id: string) => void;
}

export function QuoteForm({ dataSourceId, sources, onSwitch }: QuoteFormProps) {
  const { toast } = useToast();

  // Every lookup is scoped to this one Data Source; sources are never mixed.
  const dataSource = sources.find((d) => d.id === dataSourceId);
  const dsParams = { dataSource: dataSourceId };

  const { data: serialsData, isLoading: isLoadingSerials } = useListSerials(dsParams, {
    query: { queryKey: getListSerialsQueryKey(dsParams) },
  });
  const { data: partsData, isLoading: isLoadingParts } = useListParts(dsParams, {
    query: { queryKey: getListPartsQueryKey(dsParams) },
  });

  // Service Type lists the source's "Service" records (labor, support,
  // contracts); Parts Configuration lists everything else (parts and
  // instruments). Both come only from the active source.
  const services = useMemo<PartItem[]>(() => {
    const fromCatalog = (partsData?.parts ?? []).filter((p) => p.category === "Service");
    const known = new Set(fromCatalog.map((p) => p.partName.trim().toLowerCase()));
    const legacy = (dataSourceId === CYTEK_SEED_ID ? LEGACY_SERVICE_TYPES : []).filter((n) => !known.has(n.toLowerCase())).map((partName) => ({
      partName,
      partNumber: "",
      listPrice: 0,
      netPrice: 0,
      category: "Service",
    }));
    return [...fromCatalog, ...legacy];
  }, [partsData, dataSourceId]);
  const lineItems = useMemo<PartItem[]>(() => (partsData?.parts ?? []).filter((p) => p.category !== "Service"), [partsData]);

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
      serviceDiscountPercent: 0,
      parts: [],
      shippingAndHandling: 0,
      notes: "",
    }
  });

  const { control, handleSubmit, watch, setValue, register, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "parts" });

  const serialNumber = watch("serialNumber");
  
  // Conditionally fetch asset data when a serial number is provided
  const lookupParams = { serial: serialNumber, ...dsParams };
  const { data: assetData, isFetching: isFetchingAsset, error: assetError } = useLookupAsset(
    lookupParams,
    {
      query: {
        queryKey: getLookupAssetQueryKey(lookupParams),
        enabled: !!serialNumber && serialNumber.trim().length > 0,
        retry: false,
      },
    }
  );

  // Switching Data Source restarts the quote (the page remounts this form)
  // so nothing populated from one catalog can mix with another. Ask first if
  // the user has already entered anything.
  const hasContent = () => {
    const v = form.getValues();
    return Boolean(v.serialNumber || v.customerName || v.serviceType || v.parts.length || v.notes);
  };
  const switchDataSource = (id: string) => {
    if (id === dataSourceId) return;
    const target = sources.find((d) => d.id === id);
    if (hasContent() && !window.confirm(`Switch to "${target?.name ?? id}"? This starts a new quote and clears everything entered so far.`)) return;
    onSwitch(id);
  };

  /** Catalog record behind a form line, used to flag items the source has no price for. */
  const findProduct = (name: string | undefined, partNumber: string | undefined): PartItem | undefined => {
    if (!name) return undefined;
    const n = name.trim().toLowerCase();
    const pn = (partNumber ?? "").trim().toLowerCase();
    return (partsData?.parts ?? []).find(
      (p) => p.partName.trim().toLowerCase() === n && (p.partNumber ?? "").trim().toLowerCase() === pn
    );
  };
  const isUnpriced = (name: string | undefined, partNumber: string | undefined, price: unknown) => {
    const match = findProduct(name, partNumber);
    return !!match && match.priced === false && !(Number(price) > 0);
  };
  const productSecondary = (item: PartItem) =>
    `${item.partNumber || ""}${item.category === "Instrument" ? " · instrument" : ""}${item.priced === false ? " · no list price" : ""}`.trim();

  // A lookup error other than "no asset with that serial" (e.g. the data
  // source is unknown to the server instance that answered, which happens on
  // serverless hosting without persistent storage) is shown, not swallowed.
  const lookupProblem = useMemo(() => {
    const e = assetError as { status?: number; data?: { error?: string }; message?: string } | null;
    if (!e) return "";
    const msg = e.data?.error || e.message || "";
    if (e.status === 404 && /No asset found/i.test(msg)) return "";
    return msg || "The serial lookup failed.";
  }, [assetError]);

  // Serial-not-found hint: shown once the typed value can no longer match any
  // serial in the data source (so it does not flash while typing a prefix).
  const serialQuery = (serialNumber ?? "").trim().toLowerCase();
  const serialHasCandidates = useMemo(() => {
    if (!serialsData?.serials || serialQuery.length < 1) return true;
    return serialsData.serials.some((s) => s.toLowerCase().includes(serialQuery));
  }, [serialsData, serialQuery]);

  // Serial-driven population. Selecting a serial finds the asset in the
  // active source and fills every field the record supplies (blank when the
  // record has nothing: values are never invented). What was filled is
  // remembered so that changing or clearing the serial removes the previous
  // asset's data while anything the user typed over it is kept.
  type AutoField = "customerName" | "accountName" | "facilityName" | "address" | "contractType" | "contractStatus" | "productName";
  const autoFilled = useRef<{ serial: string; values: Partial<Record<AutoField, string>> } | null>(null);
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

  useEffect(() => {
    const prev = autoFilled.current;
    if (!prev || norm(serialNumber) === norm(prev.serial)) return;
    // The serial no longer matches the asset that populated the form.
    for (const [field, value] of Object.entries(prev.values) as [AutoField, string][]) {
      if (form.getValues(field) === value) setValue(field, "", { shouldValidate: false });
    }
    autoFilled.current = null;
  }, [serialNumber, form, setValue]);

  useEffect(() => {
    const asset = assetData?.asset;
    if (!asset || norm(asset.serialNumber) !== norm(serialNumber)) return;
    const fullAddress = [asset.street, asset.city, asset.stateZip].filter(Boolean).join(", ");
    const values: Partial<Record<AutoField, string>> = {
      accountName: asset.accountName ?? "",
      facilityName: asset.facilityName ?? "",
      address: fullAddress,
      contractType: asset.contractType ?? "",
      contractStatus: asset.contractStatus ?? "",
      productName: asset.productName ?? "",
    };
    // Customer Name is the person on the quote: taken from the asset's contact
    // when the field is still empty (or holds a previous auto-fill).
    const current = form.getValues("customerName");
    const previous = autoFilled.current?.values.customerName;
    if (asset.contactName && (!current || current === previous)) values.customerName = asset.contactName;
    for (const [field, value] of Object.entries(values) as [AutoField, string][]) {
      setValue(field, value, { shouldValidate: field === "accountName" || field === "customerName" });
    }
    autoFilled.current = { serial: asset.serialNumber, values };

    toast({
      title: "Asset found",
      description: `Loaded data for ${asset.assetName || serialNumber}`,
    });
  }, [assetData, setValue, serialNumber, toast, form]);

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
        const serverMessage = err?.data?.error;
        toast({
          variant: "destructive",
          title: "Failed to generate quote",
          description: serverMessage || err.message || "An unexpected error occurred.",
        });
      }
    }
  });

  // Documents are branded by this source's own Quote Profile; until it is
  // complete the server refuses to generate, so say so up front.
  const profileReady = dataSource?.quoteProfile.complete ?? false;

  const onSubmit = (data: QuoteFormValues) => {
    const payload: QuoteRequest = {
      dataSource: dataSourceId,
      customerName: data.customerName,
      accountName: data.accountName,
      facilityName: data.facilityName,
      address: data.address,
      serialNumber: data.serialNumber,
      contractType: data.contractType,
      productName: data.productName,
      serviceType: data.serviceType,
      servicePrice: data.servicePrice,
      serviceDiscountPercent: data.serviceDiscountPercent || 0,
      parts: data.parts.map(p => ({
        description: p.description,
        partNumber: p.partNumber,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        discountPercent: p.discountPercent || 0,
        netPrice: applyDiscount(p.unitPrice, p.discountPercent),
      })),
      shipping: data.shippingAndHandling || 0,
      notes: data.notes
    };
    generateMutation.mutate({ data: payload });
  };

  // Calculations (on-screen summary; the PDF recomputes server-side).
  // Inputs registered on number fields arrive as strings until submit, so
  // coerce here or "subtotal + shipping" would concatenate and show NaN.
  const parts = watch("parts");
  const serviceListPrice = Number(watch("servicePrice")) || 0;
  const servicePrice = applyDiscount(serviceListPrice, watch("serviceDiscountPercent"));
  const sh = Number(watch("shippingAndHandling")) || 0;
  
  const partsTotal = roundMoney(parts.reduce((acc, part) => {
    const qty = Number(part.quantity) || 0;
    return acc + roundMoney(qty * applyDiscount(part.unitPrice, part.discountPercent));
  }, 0));
  
  const subtotal = roundMoney(servicePrice + partsTotal);
  const total = roundMoney(subtotal + sh);

  // Render Helpers
  const ErrorMsg = ({ field }: { field: string }) => {
    // Basic nested error resolution
    const error = field.split('.').reduce((obj: any, key) => obj?.[key], errors);
    if (!error) return null;
    return <p className="text-destructive text-xs mt-1 font-medium">{error.message}</p>;
  };

  const InputLabel = ({ children, icon: Icon, required }: { children: React.ReactNode, icon?: any, required?: boolean }) => (
    <label className="flex items-center text-sm font-semibold text-secondary-foreground mb-1.5">
      {Icon && <Icon className="w-4 h-4 mr-2 text-primary/70" />}
      {children} {required && <span className="text-destructive ml-1">*</span>}
    </label>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 pb-20">
      
      {/* 1. CUSTOMER INFORMATION */}
      <section className="bg-card rounded-2xl p-6 shadow-card border border-border">
        <div className="flex flex-wrap items-center gap-3 mb-6 pb-4 border-b border-border/60">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl">Customer Information</h2>
            <p className="text-sm text-muted-foreground">
              Details populated automatically from serial lookup
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm" data-testid="active-data-source">
            <span className="text-muted-foreground">Data Source:</span>
            {sources.length > 1 ? (
              <select
                value={dataSourceId}
                onChange={(e) => switchDataSource(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-1 text-sm font-semibold text-foreground"
                aria-label="Data source"
              >
                {sources.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            ) : (
              <span className="font-semibold text-foreground">{dataSource?.name ?? dataSourceId}</span>
            )}
            {dataSource && (
              <span className="hidden md:inline text-xs text-muted-foreground">
                {dataSource.assetCount.toLocaleString()} assets · {dataSource.productCount.toLocaleString()} products
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <InputLabel icon={User} required>Customer Name</InputLabel>
            <input 
              {...register("customerName")} 
              className={cn(
                "w-full px-4 py-2.5 rounded-xl border bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20",
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
              placeholder="Select a serial number..."
              aria-label="Serial Number"
              name="serialNumber"
              disabled={isLoadingSerials}
              icon={isFetchingAsset ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Search className="w-4 h-4 text-muted-foreground" />}
            />
            <ErrorMsg field="serialNumber" />
            {lookupProblem && (
              <p className="text-xs mt-1 text-destructive" role="alert" data-testid="lookup-problem">
                Could not look this serial up: {lookupProblem}
              </p>
            )}
            {!serialHasCandidates && (
              <p className="text-xs mt-1 text-warning-foreground">
                No asset with this serial in the {dataSource?.name ?? "current"} data. You can fill in the customer details manually.
              </p>
            )}
          </div>

          <div>
            <InputLabel icon={Building2}>Account Name</InputLabel>
            <input 
              {...register("accountName")} 
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <InputLabel icon={Building2}>Facility Name</InputLabel>
            <input 
              {...register("facilityName")} 
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="md:col-span-2">
            <InputLabel icon={MapPin}>Address</InputLabel>
            <input 
              {...register("address")} 
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Read-only info badges from Asset Lookup */}
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="bg-surface border border-border/60 rounded-xl p-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Contract Type</span>
              <span className="text-sm font-medium text-foreground">{watch("contractType") || "—"}</span>
            </div>
            <div className="bg-surface border border-border/60 rounded-xl p-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Status</span>
              <span className="text-sm font-medium text-foreground">
                {watch("contractStatus") ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-success/15 text-success-foreground">
                    {watch("contractStatus")}
                  </span>
                ) : "—"}
              </span>
            </div>
            <div className="bg-surface border border-border/60 rounded-xl p-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Instrument</span>
              <span className="text-sm font-medium text-foreground">{watch("productName") || "—"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. SERVICE QUOTE */}
      <section className="bg-card rounded-2xl p-6 shadow-card border border-border">
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
            <Autocomplete
              items={services}
              value={watch("serviceType") ?? ""}
              onChange={(val) => setValue("serviceType", val, { shouldValidate: true })}
              onSelect={(item: PartItem) => {
                setValue("servicePrice", item.listPrice || 0, { shouldValidate: true });
              }}
              onClear={() => setValue("servicePrice", 0, { shouldValidate: true })}
              aria-label="Service Type"
              name="serviceType"
              getDisplayValue={(item: PartItem) => item.partName}
              getSearchValue={(item: PartItem) => `${item.partName} ${item.partNumber || ""}`}
              getSecondaryValue={productSecondary}
              placeholder="Search services (e.g. On-Site Support)..."
              disabled={isLoadingParts}
              icon={<Settings2 className="w-4 h-4 text-muted-foreground" />}
            />
            {isUnpriced(watch("serviceType"), "", watch("servicePrice")) && (
              <p className="text-xs mt-1 text-warning-foreground">
                No list price in the {dataSource?.name ?? "current"} data for this service. Enter a price.
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <InputLabel>Service Price ($)</InputLabel>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">$</span>
                <input 
                  type="number" 
                  step="0.01"
                  {...register("servicePrice")} 
                  className="w-full pl-7 pr-2 py-2.5 rounded-xl border border-input bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <ErrorMsg field="servicePrice" />
            </div>
            <div className="col-span-1">
              <InputLabel>Discount %</InputLabel>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                placeholder="0"
                {...register("serviceDiscountPercent")}
                className="w-full px-3 py-2.5 rounded-xl border border-input bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <ErrorMsg field="serviceDiscountPercent" />
            </div>
            <div className="col-span-1">
              <InputLabel>Adjusted</InputLabel>
              <div className="w-full px-3 py-2.5 rounded-xl border border-transparent bg-surface-muted text-sm font-medium text-secondary-foreground" data-testid="service-adjusted">
                {formatCurrency(servicePrice)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. PARTS QUOTE */}
      <section className="bg-card rounded-2xl p-6 shadow-card border border-border">
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
            onClick={() => append({ description: "", partNumber: "", quantity: 1, unitPrice: 0, discountPercent: 0 })}
            className="flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground shadow hover:bg-primary/90 hover:shadow-md transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add Part
          </button>
        </div>

        <div className="space-y-4">
          {fields.length === 0 && (
            <div className="py-8 text-center flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl bg-surface">
              <FileBox className="w-12 h-12 text-muted-foreground/50 mb-3" />
              <h3 className="text-sm font-medium text-muted-foreground mb-1">No parts added</h3>
              <p className="text-xs text-muted-foreground mb-4">Click "Add Part" to include components in this quote.</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {fields.map((field, index) => {
              const qty = Number(watch(`parts.${index}.quantity`)) || 0;
              const price = watch(`parts.${index}.unitPrice`);
              const discount = watch(`parts.${index}.discountPercent`);
              const adjusted = applyDiscount(price, discount);
              const extPrice = roundMoney(qty * adjusted);
              const unpriced = isUnpriced(watch(`parts.${index}.description`), watch(`parts.${index}.partNumber`), price);

              return (
                <motion.div
                  key={field.id}
                  initial={{ opacity: 0, height: 0, scale: 0.95 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start p-4 bg-surface border border-border rounded-xl group relative overflow-hidden"
                >
                  <div className="lg:col-span-3">
                    <InputLabel required>Part Description</InputLabel>
                    <Autocomplete
                      items={lineItems}
                      value={watch(`parts.${index}.description`)}
                      onChange={(val) => setValue(`parts.${index}.description`, val, { shouldValidate: true })}
                      onSelect={(item: PartItem) => {
                        setValue(`parts.${index}.partNumber`, item.partNumber || "");
                        setValue(`parts.${index}.unitPrice`, roundMoney(item.listPrice || 0), { shouldValidate: true });
                      }}
                      onClear={() => {
                        setValue(`parts.${index}.partNumber`, "");
                        setValue(`parts.${index}.unitPrice`, 0, { shouldValidate: true });
                      }}
                      aria-label="Part Description"
                      name={`parts.${index}.description`}
                      getDisplayValue={(item: PartItem) => item.partName}
                      getSearchValue={(item: PartItem) => `${item.partName} ${item.partNumber || ""}`}
                      getSecondaryValue={productSecondary}
                      placeholder="Search parts catalog..."
                      disabled={isLoadingParts}
                      icon={<FileBox className="w-4 h-4 text-muted-foreground" />}
                    />
                    <ErrorMsg field={`parts.${index}.description`} />
                    {unpriced && (
                      <p className="text-xs mt-1 text-warning-foreground">
                        No list price in the {dataSource?.name ?? "current"} data for this item. Enter a price.
                      </p>
                    )}
                  </div>

                  <div className="lg:col-span-2">
                    <InputLabel>Part Number</InputLabel>
                    <input 
                      {...register(`parts.${index}.partNumber`)} 
                      className="w-full px-3 py-2.5 rounded-lg border border-input bg-card text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      placeholder="e.g. PN-123"
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 lg:col-span-6 gap-3">
                    <div>
                      <InputLabel required>Unit Price</InputLabel>
                      <div className="relative">
                        <span className="absolute left-2.5 top-2.5 text-muted-foreground text-sm">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          {...register(`parts.${index}.unitPrice`)} 
                          className="w-full pl-6 pr-2 py-2.5 rounded-lg border border-input bg-card text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <ErrorMsg field={`parts.${index}.unitPrice`} />
                    </div>

                    <div>
                      <InputLabel>Disc. %</InputLabel>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        placeholder="0"
                        {...register(`parts.${index}.discountPercent`)}
                        className="w-full px-2 py-2.5 rounded-lg border border-input bg-card text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                      <ErrorMsg field={`parts.${index}.discountPercent`} />
                    </div>

                    <div>
                      <InputLabel>Adjusted</InputLabel>
                      <div className="w-full px-2 py-2.5 rounded-lg bg-surface-muted text-sm font-medium text-secondary-foreground truncate" data-testid={`parts-${index}-adjusted`}>
                        {formatCurrency(adjusted)}
                      </div>
                    </div>

                    <div>
                      <InputLabel required>Qty</InputLabel>
                      <input 
                        type="number" 
                        {...register(`parts.${index}.quantity`)} 
                        className="w-full px-2 py-2.5 rounded-lg border border-input bg-card text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                      <ErrorMsg field={`parts.${index}.quantity`} />
                    </div>

                    <div>
                      <InputLabel>Line Total</InputLabel>
                      <div className="w-full px-2 py-2.5 rounded-lg bg-card border border-border text-sm font-semibold text-secondary-foreground truncate" data-testid={`parts-${index}-total`}>
                        {formatCurrency(extPrice)}
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-1 flex items-center justify-end h-full pt-6 lg:pt-0">
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      title="Remove Part"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* 4. NOTES */}
        <section className="lg:col-span-7 bg-card rounded-2xl p-6 shadow-card border border-border h-full">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border/60">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="text-xl">Additional Notes</h2>
          </div>
          <textarea
            {...register("notes")}
            rows={5}
            className="w-full p-4 rounded-xl border border-input bg-surface focus:bg-card text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            placeholder="Add any specific notes, terms, or conditions to include on the PDF quote..."
          />
        </section>

        {/* 5. TOTALS */}
        <section className="lg:col-span-5 bg-summary border border-border/60 rounded-2xl p-1 shadow-card text-summary-foreground relative overflow-hidden">
          {/* Decorative background element */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-primary/30 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="bg-summary/50 backdrop-blur-md rounded-[14px] p-6 h-full flex flex-col justify-between relative z-10">
            <div>
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                <Calculator className="w-5 h-5 text-summary-foreground" />
                <h2 className="text-xl text-summary-foreground">Summary</h2>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center text-summary-muted">
                  <span>Service Subtotal</span>
                  <span className="font-medium text-summary-foreground">{formatCurrency(servicePrice)}</span>
                </div>
                <div className="flex justify-between items-center text-summary-muted">
                  <span>Parts Subtotal</span>
                  <span className="font-medium text-summary-foreground">{formatCurrency(partsTotal)}</span>
                </div>
                <div className="flex justify-between items-center text-summary-muted pt-2 border-t border-white/5">
                  <span>Subtotal</span>
                  <span className="font-medium text-summary-foreground">{formatCurrency(subtotal)}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-summary-muted">Shipping & Handling</span>
                  <div className="w-32 relative">
                    <span className="absolute left-3 top-2 text-summary-muted text-sm font-medium">$</span>
                    <input 
                      type="number" 
                      step="0.01"
                      {...register("shippingAndHandling")} 
                      className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-white/20 bg-white/5 text-summary-foreground text-sm text-right focus:outline-none focus:border-primary focus:bg-white/10 transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-end pt-4 border-t border-white/10 mb-6">
                <span className="text-lg text-summary-muted">Total Quote</span>
                <span className="text-4xl font-bold font-display text-summary-foreground tracking-tight">
                  {formatCurrency(total)}
                </span>
              </div>

              {dataSource && !profileReady && (
                <p className="mb-3 text-xs text-summary-muted flex items-center gap-1.5" data-testid="profile-incomplete">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span><Link href={`/data-sources/${encodeURIComponent(dataSource.id)}/profile`} className="underline font-semibold text-summary-foreground">Complete the Quote Profile</Link> to generate this quote.</span>
                </p>
              )}
              <button
                type="submit"
                disabled={generateMutation.isPending || !profileReady}
                className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
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
