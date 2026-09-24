import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutocompleteProps<T> {
  items: T[];
  value: string;
  onChange: (value: string) => void;
  onSelect?: (item: T) => void;
  getDisplayValue: (item: T) => string;
  getSearchValue?: (item: T) => string;
  /** Optional muted text shown next to each option (e.g. a part number) to tell duplicates apart. */
  getSecondaryValue?: (item: T) => string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function Autocomplete<T>({
  items,
  value,
  onChange,
  onSelect,
  getDisplayValue,
  getSearchValue,
  getSecondaryValue,
  placeholder = "Search...",
  className,
  disabled = false,
  icon = <Search className="w-4 h-4 text-muted-foreground" />
}: AutocompleteProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchFn = getSearchValue || getDisplayValue;
  
  const filteredItems = items.filter(item => 
    searchFn(item).toLowerCase().includes(value.toLowerCase())
  ).slice(0, 50); // limit to 50 results for performance

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      <div className="relative flex items-center">
        <div className="absolute left-3 flex items-center justify-center">
          {icon}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-input bg-card text-sm text-foreground shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-muted-foreground"
        />
        <div className="absolute right-3 flex items-center justify-center pointer-events-none text-muted-foreground">
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1.5 bg-card border border-border rounded-xl shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-64 flex flex-col">
          <div className="overflow-y-auto overflow-x-hidden flex-1 p-1">
            {filteredItems.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                No results found.
              </div>
            ) : (
              filteredItems.map((item, index) => {
                const display = getDisplayValue(item);
                const secondary = getSecondaryValue ? getSecondaryValue(item) : "";
                const isSelected = display === value;
                return (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 text-sm rounded-lg cursor-pointer transition-colors",
                      isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                    )}
                    onClick={() => {
                      onChange(display);
                      if (onSelect) onSelect(item);
                      setIsOpen(false);
                    }}
                  >
                    <span className="truncate">{display}</span>
                    <span className="flex items-center gap-2 shrink-0 pl-3">
                      {secondary && <span className="text-xs text-muted-foreground font-mono">{secondary}</span>}
                      {isSelected && <Check className="w-4 h-4 shrink-0" />}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
