import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutocompleteProps<T> {
  items: T[];
  /** The committed value (free text or a chosen item's display value). */
  value: string;
  onChange: (value: string) => void;
  onSelect?: (item: T) => void;
  /** Called when the user clears the field with the × button (after onChange("")). */
  onClear?: () => void;
  getDisplayValue: (item: T) => string;
  getSearchValue?: (item: T) => string;
  /** Optional muted text shown next to each option (e.g. a part number) to tell duplicates apart. */
  getSecondaryValue?: (item: T) => string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  /** Max options rendered at once (the list is filtered as the user types). */
  limit?: number;
  name?: string;
  "aria-label"?: string;
}

/**
 * Searchable single-select combobox over records from the active Data Source.
 *
 * The committed `value` and the filter text are kept apart on purpose: while
 * the list is closed the input shows the value; opening it shows *every* item
 * (the selected one highlighted) and only what the user types afterwards
 * narrows the list. Selecting an item commits it and resets the filter, so
 * reopening never shows just the selected entry. The × button clears the
 * value (and tells the owner through `onClear`, e.g. to reset a price).
 */
export function Autocomplete<T>({
  items,
  value,
  onChange,
  onSelect,
  onClear,
  getDisplayValue,
  getSearchValue,
  getSecondaryValue,
  placeholder = "Search...",
  className,
  disabled = false,
  icon = <Search className="w-4 h-4 text-muted-foreground" />,
  limit = 50,
  name,
  "aria-label": ariaLabel,
}: AutocompleteProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  /** Filter text while the list is open; null = not typing (show everything). */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const close = () => {
    setIsOpen(false);
    setQuery(null);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) close();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchFn = getSearchValue || getDisplayValue;
  const filteredItems = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    const matched = q ? items.filter((item) => searchFn(item).toLowerCase().includes(q)) : items;
    return matched.slice(0, limit);
  }, [items, query, limit, searchFn]);
  const total = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    return q ? items.filter((item) => searchFn(item).toLowerCase().includes(q)).length : items.length;
  }, [items, query, searchFn]);

  // Keep the highlighted row valid and in view as the list changes.
  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = filteredItems.findIndex((item) => getDisplayValue(item) === value);
    setActive(selectedIdx >= 0 ? selectedIdx : 0);
  }, [isOpen, query, filteredItems.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, isOpen]);

  const choose = (item: T) => {
    onChange(getDisplayValue(item));
    if (onSelect) onSelect(item);
    close();
  };

  const clear = () => {
    onChange("");
    onClear?.();
    setQuery(null);
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (!filteredItems.length) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % filteredItems.length : (i - 1 + filteredItems.length) % filteredItems.length));
    } else if (e.key === "Enter") {
      if (isOpen && filteredItems[active] !== undefined) {
        e.preventDefault();
        choose(filteredItems[active]);
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  };

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      <div className="relative flex items-center">
        <div className="absolute left-3 flex items-center justify-center pointer-events-none">{icon}</div>
        <input
          ref={inputRef}
          type="text"
          name={name}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoComplete="off"
          value={query ?? value}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-10 pr-16 py-2.5 rounded-xl border border-input bg-card text-sm text-foreground shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-muted-foreground"
        />
        <div className="absolute right-2 flex items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Clear"
              title="Clear"
              data-testid="autocomplete-clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (isOpen ? close() : (setIsOpen(true), inputRef.current?.focus()))}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            aria-label={isOpen ? "Close options" : "Show all options"}
            disabled={disabled}
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
          </button>
        </div>
      </div>

      {isOpen && !disabled && (
        <div
          id={listId}
          role="listbox"
          ref={listRef}
          className="absolute z-50 w-full mt-1.5 bg-card border border-border rounded-xl shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-64 flex flex-col"
        >
          <div className="overflow-y-auto overflow-x-hidden flex-1 p-1">
            {filteredItems.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                {items.length === 0 ? "Nothing available in this data source." : "No results found."}
              </div>
            ) : (
              filteredItems.map((item, index) => {
                const display = getDisplayValue(item);
                const secondary = getSecondaryValue ? getSecondaryValue(item) : "";
                const isSelected = display === value;
                return (
                  <div
                    key={index}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 text-sm rounded-lg cursor-pointer transition-colors",
                      isSelected ? "bg-primary/10 text-primary font-medium" : "text-foreground",
                      index === active && !isSelected && "bg-muted",
                      index === active && isSelected && "bg-primary/15",
                    )}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
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
          {total > filteredItems.length && (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border/60 bg-surface">
              Showing {filteredItems.length} of {total.toLocaleString()}. Keep typing to narrow the list.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
