"use client"
import React, { useState, useEffect } from 'react'
import { createClient } from '@/app/supabase-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import IngredientAutocomplete from '@/components/ingredient-autocomplete'
import * as XLSX from 'xlsx' // Requires: npm install xlsx

export default function ImportPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  type LocationRow = { id: string; name: string }
  type IngredientMatch = { id: string; name: string; unit?: string; last_price?: number }
  type ParsedRecord = {
    cost_date: string
    supplier: string
    account_description: string
    amount: number
    cost_type: string
    source: string
    product_name: string
    quantity: number
    unit: string
    sale_date: string
    override_ingredient_id: string | null
    matched_ingredient?: IngredientMatch | null
  }

  const [locations, setLocations] = useState<LocationRow[]>([])
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [productCol, setProductCol] = useState('D')
  const [quantityCol, setQuantityCol] = useState('Q')
  const [priceCol, setPriceCol] = useState('S')
  const [parsedRecords, setParsedRecords] = useState<ParsedRecord[]>([])
  const [processingPreview, setProcessingPreview] = useState(false)
  
  // ── Weekly Sales Import (Excel) ──
  type DishMatch = { id: string; dish_name: string; recipe_id: string | null }
  type SalesRecord = {
    product_name: string
    qty_sold: number
    gross_sales: number
    net_sales: number
    discount_value: number
    value_without_discounts: number
    profit: number
    cost: number
    matched_dish?: DishMatch | null
  }

  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [salesProcessing, setSalesProcessing] = useState(false)
  const [salesDate, setSalesDate] = useState('')
  const [dishSearchResults, setDishSearchResults] = useState<DishMatch[]>([])
  const [dishSearchQuery, setDishSearchQuery] = useState('')
  
  useEffect(() => {
    ;(async () => {
      try {
        const res = await supabase.from('locations').select('id,name')
        const data = res.data as LocationRow[] | null
        setLocations(data || [])
        if (data && data.length === 1) setSelectedLocation(data[0].id)
      } catch (err) {
        console.warn('Could not fetch locations', err)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  // Logic to classify COS vs SEMIS based on "RK" Description
  const classifyCost = (rk: string) => {
    const lower = rk.toLowerCase()
    // Define your mapping rules here
    if (lower.includes('food') || lower.includes('bev') || lower.includes('meat') || lower.includes('produce')) {
      return 'COS'
    }
    return 'SEMIS' // Default to Operating Expense
  }

  // Helper to convert Excel Serial Date to JS Date
  const excelDateToJSDate = (serial: number) => {
    const utc_days  = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;                                        
    const date_info = new Date(utc_value * 1000);
    return date_info.toISOString().split('T')[0];
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    const reader = new FileReader()
    
    reader.onload = async (evt: ProgressEvent<FileReader>) => {
      const bstr = evt.target?.result as string | ArrayBuffer
      let wb
      if (typeof bstr === 'string') {
        wb = XLSX.read(bstr, { type: 'binary' })
      } else {
        wb = XLSX.read(new Uint8Array(bstr as ArrayBuffer), { type: 'array' })
      }
      const wsname = wb.SheetNames[0]
      const ws = wb.Sheets[wsname]
      
      // Convert to JSON (Array of arrays to handle columns by index/letter easier)
      const data = XLSX.utils.sheet_to_json(ws, { header: "A" }) as Array<Record<string, unknown>>

      // Convert rows into preview records (no DB writes yet)
      const preview: ParsedRecord[] = []
      data.forEach((row) => {
        const dateCell = row['E']
        const priceCell = row[priceCol]
        if (!dateCell || !priceCell) return
        const saleDateRaw = dateCell
        let finalDate = String(saleDateRaw)
        if (typeof saleDateRaw === 'number') finalDate = excelDateToJSDate(saleDateRaw)
        const supplier = (row['G'] as string) || 'Unknown'
        const rk = (row['RK'] as string) || (row['H'] as string) || ''
        const amount = Number(priceCell as unknown)
        const productName = row[productCol] as string | undefined
        const qty = row[quantityCol] as number | undefined
        const costType = classifyCost(String(rk))
        if (!amount) return
        preview.push({
          cost_date: finalDate,
          supplier: String(supplier),
          account_description: String(rk),
          amount: Number(amount),
          cost_type: costType,
          source: 'IMPORT_EXCEL',
          product_name: productName ? String(productName) : '',
          quantity: qty ? Number(qty) : 1,
          unit: (row['U'] as string) || '',
          sale_date: finalDate,
          override_ingredient_id: null,
        })
      })

      // attempt automatic matching for preview
      if (preview.length > 0) {
        const uniqueNames = Array.from(new Set(preview.map(p => (p.product_name || '').toLowerCase()).filter(Boolean)))
        const lookups = await Promise.all(uniqueNames.map(n => supabase.from('ingredients').select('id,unit,last_price,name').ilike('name', `%${n}%`).limit(1).maybeSingle()))
        const nameToIngredient: Record<string, ParsedRecord['matched_ingredient'] | null> = {}
        lookups.forEach((r: any, idx: number) => { if (r && r.data) nameToIngredient[uniqueNames[idx]] = r.data as ParsedRecord['matched_ingredient'] })
        const mapped = preview.map(p => ({ ...p, matched_ingredient: nameToIngredient[(p.product_name || '').toLowerCase()] || null }))
        setParsedRecords(mapped)
      } else {
        setParsedRecords(preview)
      }
      setLoading(false)
    }
    reader.readAsBinaryString(file)
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SALES IMPORT (WEEKLY) – Produkt / Ilość sprzedanych / Wartości sprzedaży
  // ────────────────────────────────────────────────────────────────────────────

  const handleSalesFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSalesLoading(true)
    const reader = new FileReader()

    reader.onload = async (evt: ProgressEvent<FileReader>) => {
      try {
        const bstr = evt.target?.result as string | ArrayBuffer
        let wb
        if (typeof bstr === 'string') {
          wb = XLSX.read(bstr, { type: 'binary' })
        } else {
          wb = XLSX.read(new Uint8Array(bstr as ArrayBuffer), { type: 'array' })
        }

        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]

        // Use header row so we can reference Polish column names directly
        const data = XLSX.utils.sheet_to_json(ws, { defval: null }) as Array<Record<string, any>>

        const preview: SalesRecord[] = []

        data.forEach((row) => {
          const productRaw = row['Produkt'] ?? row['product'] ?? row['Product']
          if (!productRaw) return

          const qtyRaw = row['Ilość sprzedanych'] ?? row['Qty'] ?? row['Quantity']
          const qty = Number(qtyRaw || 0)
          if (!qty || isNaN(qty)) return

          const gross = Number(row['Wartość sprzedaży'] ?? 0) || 0
          const net = Number(row['Wartość sprzedaży netto'] ?? 0) || gross
          const disc = Number(row['Wartość zniżek'] ?? 0) || 0
          const withoutDisc = Number(row['Wartość bez zniżek'] ?? 0) || gross + disc
          const profit = Number(row['Zysk'] ?? 0) || 0
          const cost = Number(row['Koszt'] ?? 0) || 0

          preview.push({
            product_name: String(productRaw).trim(),
            qty_sold: qty,
            gross_sales: gross,
            net_sales: net,
            discount_value: disc,
            value_without_discounts: withoutDisc,
            profit,
            cost,
          })
        })

        // Try to auto‑match Produkt -> dishes (menu items) for the selected location
        if (preview.length > 0) {
          const uniqueNames = Array.from(
            new Set(
              preview
                .map((p) => p.product_name.toLowerCase())
                .filter((n) => n && n.trim().length > 0)
            )
          )

          const nameToDish: Record<string, DishMatch | null> = {}

          for (const name of uniqueNames) {
            const base = name.replace(/\s+/g, ' ').trim()
            if (!base) continue

            const { data: dish } = await supabase
              .from('dishes')
              .select('id, dish_name, recipe_id, location_id')
              .eq('location_id', selectedLocation || '')
              .ilike('dish_name', `%${base}%`)
              .limit(1)
              .maybeSingle()

            if (dish) {
              nameToDish[base] = {
                id: dish.id,
                dish_name: dish.dish_name,
                recipe_id: dish.recipe_id,
              }
            } else {
              nameToDish[base] = null
            }
          }

          const mapped = preview.map((p) => {
            const key = p.product_name.toLowerCase().replace(/\s+/g, ' ').trim()
            return {
              ...p,
              matched_dish: nameToDish[key] ?? null,
            }
          })

          setSalesRecords(mapped)
        } else {
          setSalesRecords(preview)
        }
      } catch (err) {
        console.error('Sales Excel parse error', err)
        alert('Błąd odczytu pliku sprzedaży: ' + String(err))
        setSalesRecords([])
      }

      setSalesLoading(false)
    }

    reader.readAsBinaryString(file)
  }

  const searchDishes = async (query: string) => {
    setDishSearchQuery(query)
    if (!query || !query.trim() || !selectedLocation) {
      setDishSearchResults([])
      return
    }
    const { data } = await supabase
      .from('dishes')
      .select('id, dish_name, recipe_id, location_id')
      .eq('location_id', selectedLocation)
      .ilike('dish_name', `%${query.trim()}%`)
      .order('dish_name')
      .limit(10)
    setDishSearchResults(
      (data || []).map((d: any) => ({ id: d.id, dish_name: d.dish_name, recipe_id: d.recipe_id }))
    )
  }

  const confirmSalesImport = async () => {
    if (!salesRecords.length) return alert('Brak wierszy sprzedaży do importu')
    if (!selectedLocation) return alert('Wybierz lokalizację dla sprzedaży')
    if (!salesDate) return alert('Wybierz datę (np. koniec tygodnia) dla sprzedaży')

    setSalesProcessing(true)

    try {
      // 1) Aggregate portions sold per dish
      const dishQty: Record<string, number> = {}
      for (const r of salesRecords) {
        const dishId = r.matched_dish?.id
        if (!dishId) continue
        dishQty[dishId] = (dishQty[dishId] || 0) + (r.qty_sold || 0)
      }

      const dishIds = Object.keys(dishQty)
      if (dishIds.length === 0) {
        alert('Brak dopasowanych dań z menu dla wierszy sprzedaży')
        setSalesProcessing(false)
        return
      }

      // 2) Fetch dishes -> recipes
      const { data: dishRows } = await supabase
        .from('dishes')
        .select('id, recipe_id')
        .in('id', dishIds)

      const recipesMap = new Map<string, { id: string; portions: number | null }>()
      const recipeIds = Array.from(
        new Set(
          (dishRows || [])
            .map((d: any) => d.recipe_id)
            .filter((id: string | null) => !!id)
        )
      ) as string[]

      if (recipeIds.length === 0) {
        alert('Wybrane dania nie mają przypisanych receptur – nie można policzyć zużycia składników')
        setSalesProcessing(false)
        return
      }

      const { data: recipeRows } = await supabase
        .from('recipes')
        .select('id, portions')
        .in('id', recipeIds)

      ;(recipeRows || []).forEach((r: any) => {
        recipesMap.set(r.id, { id: r.id, portions: r.portions })
      })

      const { data: recipeIngredients } = await supabase
        .from('recipe_ingredients')
        .select('recipe_id, ingredient_id, product_id, quantity, unit, source')
        .in('recipe_id', recipeIds)

      const ingredientsByRecipe = new Map<string, any[]>()
      ;(recipeIngredients || []).forEach((ri: any) => {
        const list = ingredientsByRecipe.get(ri.recipe_id) || []
        list.push(ri)
        ingredientsByRecipe.set(ri.recipe_id, list)
      })

      // 3) Compute total ingredient & product usage for all sold dishes
      const ingredientUsage = new Map<string, number>()
      const ingredientUnit = new Map<string, string>()
      const productUsage = new Map<string, number>()
      const productUnit = new Map<string, string>()

      ;(dishRows || []).forEach((d: any) => {
        const totalPortions = dishQty[d.id] || 0
        if (!totalPortions) return

        const recipeId = d.recipe_id as string | null
        if (!recipeId) return

        const recipe = recipesMap.get(recipeId)
        const portions = recipe?.portions && recipe.portions > 0 ? Number(recipe.portions) : 1

        const items = ingredientsByRecipe.get(recipeId) || []
        items.forEach((ri: any) => {
          const perPortionQty = (Number(ri.quantity) || 0) / portions
          const totalUsage = perPortionQty * totalPortions
          if (!totalUsage) return

          const unit = (ri.unit as string) || 'pcs'

          if (ri.source === 'product' && ri.product_id) {
            const key = ri.product_id as string
            productUsage.set(key, (productUsage.get(key) || 0) + totalUsage)
            if (!productUnit.has(key)) productUnit.set(key, unit)
          } else if (ri.ingredient_id) {
            const key = ri.ingredient_id as string
            ingredientUsage.set(key, (ingredientUsage.get(key) || 0) + totalUsage)
            if (!ingredientUnit.has(key)) ingredientUnit.set(key, unit)
          }
        })
      })

      // 4) Create inventory_transactions that subtract stock (tx_type != 'invoice_in')
      const txs: any[] = []

      ingredientUsage.forEach((qty, ingredientId) => {
        if (!qty) return
        txs.push({
          ingredient_id: ingredientId,
          product_id: null,
          location_id: selectedLocation,
          tx_type: 'sale',
          quantity: qty,
          unit: ingredientUnit.get(ingredientId) || 'pcs',
          price: null,
          reference: 'SALES_EXCEL',
          reason: 'Weekly sales import',
          created_at: salesDate,
        })
      })

      productUsage.forEach((qty, productId) => {
        if (!qty) return
        txs.push({
          ingredient_id: null,
          product_id: productId,
          location_id: selectedLocation,
          tx_type: 'sale',
          quantity: qty,
          unit: productUnit.get(productId) || 'pcs',
          price: null,
          reference: 'SALES_EXCEL',
          reason: 'Weekly sales import (product)',
          created_at: salesDate,
        })
      })

      if (!txs.length) {
        alert('Nie wyliczono żadnego zużycia składników na podstawie sprzedaży')
        setSalesProcessing(false)
        return
      }

      const { error: txError } = await supabase.from('inventory_transactions').insert(txs)
      if (txError) {
        console.error('Sales import transactions error', txError)
        alert('Błąd zapisu transakcji magazynowych ze sprzedaży: ' + txError.message)
        setSalesProcessing(false)
        return
      }

      alert(`✅ Zaimportowano sprzedaż. Utworzono ${txs.length} transakcji magazynowych (składniki + produkty).`)
      setSalesRecords([])
    } catch (err) {
      console.error('Sales import error', err)
      alert('Import sprzedaży nie powiódł się: ' + String(err))
    }

    setSalesProcessing(false)
  }

  const confirmImport = async () => {
    if (!parsedRecords.length) return alert('No records to import')
    if (!selectedLocation) return alert('Select a location')
    setProcessingPreview(true)
    try {
      const resolvedInventory: Array<Record<string, unknown>> = []
      const resolvedPrices: Array<Record<string, unknown>> = []
      // resolve ingredient ids from matched or overrides
      for (const r of parsedRecords) {
        const prod = (r.override_ingredient_id || r.matched_ingredient?.id) || null
        if (prod) {
          resolvedInventory.push({ ingredient_id: prod, location_id: selectedLocation, tx_type: 'invoice_in', quantity: r.quantity || 1, unit: r.unit || 'pcs', price: r.amount, reference: 'IMPORT_EXCEL', created_at: r.sale_date })
          resolvedPrices.push({ ingredient_id: prod, price: r.amount, unit: r.unit || '', supplier: r.supplier || null, invoice_ref: null, recorded_at: r.sale_date })
        }
      }
      if (resolvedInventory.length) await supabase.from('inventory_transactions').insert(resolvedInventory)
      if (resolvedPrices.length) {
        await supabase.from('ingredient_prices_history').insert(resolvedPrices)
        await Promise.all(resolvedPrices.map(p => supabase.from('ingredients').update({ last_price: p.price }).eq('id', p.ingredient_id)))
        // Call server-side RPC to create alerts for significant price changes
        try {
          await supabase.rpc('check_price_changes', { price_history_json: resolvedPrices, price_change_threshold: 0.1, location_id: selectedLocation })
        } catch (rpcErr) {
          console.warn('Price check RPC failed', rpcErr)
        }
      }
      alert(`Imported ${parsedRecords.length} rows. Created ${resolvedInventory.length} inventory transactions and ${resolvedPrices.length} price history records.`)
      setParsedRecords([])
    } catch (err) {
      console.error(err)
      alert('Import failed: ' + String(err))
    }
    setProcessingPreview(false)
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Excel Cost Import</h1>
      <Card>
        <CardHeader><CardTitle>Upload Wide Invoice Records</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Mapping: Col E (Date) | Col G (Supplier) | Col RK (Account) | Col S (Amount)</p>
            <div className="flex gap-2 items-center">
              <label className="text-sm">Location:</label>
              <select value={selectedLocation || ''} onChange={e => setSelectedLocation(e.target.value)}>
                <option value="">Select location</option>
                {locations.map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
              </select>
              <label className="text-sm">Product Col:</label>
              <Input value={productCol} onChange={e => setProductCol(e.target.value.toUpperCase())} />
              <label className="text-sm">Qty Col:</label>
              <Input value={quantityCol} onChange={e => setQuantityCol(e.target.value.toUpperCase())} />
              <label className="text-sm">Price Col:</label>
              <Input value={priceCol} onChange={e => setPriceCol(e.target.value.toUpperCase())} />
            </div>
            <Input type="file" onChange={handleFileUpload} accept=".xlsx, .xls" disabled={loading} />
            {loading && <p>Processing...</p>}
            {parsedRecords.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold mb-2">Preview ({parsedRecords.length})</h3>
                <div className="overflow-auto max-h-64 border rounded">
                  <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500 border-b"><th className="p-2">Product</th><th>Qty</th><th>Price</th><th>Matched Ingredient</th></tr></thead>
                    <tbody>
                      {parsedRecords.map((r, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-2">{r.product_name || '—'}</td>
                          <td className="p-2">{r.quantity}</td>
                          <td className="p-2">{r.amount}</td>
                          <td className="p-2">
                            {r.matched_ingredient ? (
                              <div className="flex items-center gap-2"><div className="text-sm font-medium">{r.matched_ingredient.name}</div>
                                <Button size="sm" variant="ghost" onClick={() => { const copy = [...parsedRecords]; copy[idx].override_ingredient_id = null; setParsedRecords(copy) }}>Clear</Button></div>
                            ) : (
                              <IngredientAutocomplete
                                value={r.product_name}
                                onChange={(v: string) => { const copy = [...parsedRecords]; copy[idx].product_name = v; setParsedRecords(copy) }}
                                onSelect={(ing) => { const copy = [...parsedRecords]; copy[idx].override_ingredient_id = ing.id; setParsedRecords(copy) }}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button onClick={confirmImport} disabled={processingPreview || loading}>Confirm Import</Button>
                  <Button variant="ghost" onClick={() => setParsedRecords([])}>Cancel Preview</Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/*  WEEKLY SALES IMPORT – subtract stock based on sold dishes       */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Weekly Sales Import (Excel)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Oczekiwane kolumny w arkuszu: <b>Produkt</b>, <b>Ilość sprzedanych</b>, <b>Wartość sprzedaży</b>,
              <b> Wartość sprzedaży netto</b>, <b>Wartość zniżek</b>, <b>Wartość bez zniżek</b>, <b>Zysk</b>, <b>Koszt</b>.
              System dopasuje kolumnę "Produkt" do dań z menu i policzy teoretyczne zużycie składników z receptur.
            </p>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm">Lokalizacja:</span>
                <select
                  value={selectedLocation || ''}
                  onChange={e => setSelectedLocation(e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="">Wybierz</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Data sprzedaży / koniec tygodnia:</span>
                <Input
                  type="date"
                  value={salesDate}
                  onChange={e => setSalesDate(e.target.value)}
                  className="w-44"
                />
              </div>
            </div>
            <Input
              type="file"
              onChange={handleSalesFileUpload}
              accept=".xlsx, .xls"
              disabled={salesLoading}
            />
            {salesLoading && <p>Przetwarzanie sprzedaży...</p>}
            {salesRecords.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold mb-2">Podgląd sprzedaży ({salesRecords.length})</h3>
                <div className="overflow-auto max-h-64 border rounded">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b">
                        <th className="p-2">Produkt</th>
                        <th className="p-2 text-right">Ilość sprzedanych</th>
                        <th className="p-2">Dopasowane danie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRecords.map((r, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-2">{r.product_name}</td>
                          <td className="p-2 text-right">{r.qty_sold}</td>
                          <td className="p-2">
                            {r.matched_dish ? (
                              <div className="flex items-center gap-2">
                                <span className="text-green-700 text-sm font-medium">{r.matched_dish.dish_name}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    const copy = [...salesRecords]
                                    copy[idx].matched_dish = null
                                    setSalesRecords(copy)
                                  }}
                                >
                                  Zmień
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <span className="block text-xs text-red-600">Brak dopasowania do dania</span>
                                <div className="flex gap-2 items-center">
                                  <Input
                                    placeholder="Szukaj dania..."
                                    className="h-8 text-xs max-w-xs"
                                    value={dishSearchQuery}
                                    onChange={async (e) => {
                                      await searchDishes(e.target.value)
                                    }}
                                  />
                                  {dishSearchResults.length > 0 && (
                                    <select
                                      className="border rounded px-1 py-1 text-xs"
                                      onChange={(e) => {
                                        const id = e.target.value
                                        if (!id) return
                                        const match = dishSearchResults.find(d => d.id === id)
                                        if (!match) return
                                        const copy = [...salesRecords]
                                        copy[idx].matched_dish = match
                                        setSalesRecords(copy)
                                      }}
                                      defaultValue=""
                                    >
                                      <option value="">Wybierz danie</option>
                                      {dishSearchResults.map(d => (
                                        <option key={d.id} value={d.id}>{d.dish_name}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button onClick={confirmSalesImport} disabled={salesProcessing || salesLoading}>
                    Zapisz zużycie składników
                  </Button>
                  <Button variant="ghost" onClick={() => setSalesRecords([])}>Wyczyść podgląd</Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}