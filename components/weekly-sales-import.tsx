"use client"

import React, { useState } from 'react'
import { createClient } from '@/app/supabase-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import * as XLSX from 'xlsx'

// Reusable Weekly Sales Import component for admin dashboard
export function WeeklySalesImport({ locations }: { locations: { id: string; name: string }[] }) {
  const supabase = createClient()

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

  const [selectedLocation, setSelectedLocation] = useState<string>('')
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [salesProcessing, setSalesProcessing] = useState(false)
  const [salesDate, setSalesDate] = useState('')
  const [dishSearchResults, setDishSearchResults] = useState<DishMatch[]>([])

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

        if (preview.length > 0 && selectedLocation) {
          const uniqueNames = Array.from(new Set(preview.map((p) => p.product_name.toLowerCase()).filter((n) => n && n.trim().length > 0)))

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
    setDishSearchResults((data || []).map((d: any) => ({ id: d.id, dish_name: d.dish_name, recipe_id: d.recipe_id })))
  }

  const confirmSalesImport = async () => {
    if (!salesRecords.length) return alert('Brak wierszy sprzedaży do importu')
    if (!selectedLocation) return alert('Wybierz lokalizację dla sprzedaży')
    if (!salesDate) return alert('Wybierz datę (np. koniec tygodnia) dla sprzedaży')

    setSalesProcessing(true)

    try {
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

      const { data: dishRows } = await supabase.from('dishes').select('id, recipe_id').in('id', dishIds)

      const recipesMap = new Map<string, { id: string; portions: number | null }>()
      const recipeIds = Array.from(
        new Set((dishRows || []).map((d: any) => d.recipe_id).filter((id: string | null) => !!id))
      ) as string[]

      if (recipeIds.length === 0) {
        alert('Wybrane dania nie mają przypisanych receptur – nie można policzyć zużycia składników')
        setSalesProcessing(false)
        return
      }

      const { data: recipeRows } = await supabase.from('recipes').select('id, portions').in('id', recipeIds)

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

  return (
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
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="">Wybierz</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Data sprzedaży / koniec tygodnia:</span>
              <Input
                type="date"
                value={salesDate}
                onChange={(e) => setSalesDate(e.target.value)}
                className="w-44"
              />
            </div>
          </div>
          <Input type="file" onChange={handleSalesFileUpload} accept=".xlsx, .xls" disabled={salesLoading} />
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
                                      const match = dishSearchResults.find((d) => d.id === id)
                                      if (!match) return
                                      const copy = [...salesRecords]
                                      copy[idx].matched_dish = match
                                      setSalesRecords(copy)
                                    }}
                                    defaultValue=""
                                  >
                                    <option value="">Wybierz danie</option>
                                    {dishSearchResults.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.dish_name}
                                      </option>
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
                <Button variant="ghost" onClick={() => setSalesRecords([])}>
                  Wyczyść podgląd
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
