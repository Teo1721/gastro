'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/app/supabase-client'

export function FinanceTable() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMounted, setHasMounted] = useState(false) // New safety guard
  const supabase = createClient()

  useEffect(() => {
    setHasMounted(true) // We are now safely in the browser
    const fetchInvoices = async () => {
      if (!supabase?.from) {
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('invoices')
          .select('*, locations(name)')
          .order('service_date', { ascending: false })
        
        if (error) throw error
        setInvoices(data || [])
      } catch (err) {
        console.error('Error:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchInvoices()
  }, [])

  // If we are prerendering on the server, return nothing.
  // This stops the builder from calling .map() and crashing.
  if (!hasMounted) return null 

  if (loading) return <div className="p-4 text-slate-500">Loading records...</div>

  return (
    <table className="w-full text-left">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr>
          <th className="p-4 font-semibold text-slate-700 text-sm">Date</th>
          <th className="p-4 font-semibold text-slate-700 text-sm">Location</th>
          <th className="p-4 font-semibold text-slate-700 text-sm">Supplier</th>
          <th className="p-4 font-semibold text-slate-700 text-sm text-right">Amount</th>
          <th className="p-4 font-semibold text-slate-700 text-sm">Status</th>
        </tr>
      </thead>
      <tbody>
        {invoices.length > 0 ? (
          invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
              <td className="p-4 text-slate-600">{inv.service_date || 'N/A'}</td>
              <td className="p-4 text-slate-600">{inv.locations?.name || 'N/A'}</td>
              <td className="p-4 font-medium text-slate-900">{inv.supplier_name || 'N/A'}</td>
              <td className="p-4 text-right font-mono text-slate-900">${inv.total_amount ?? 0}</td>
              <td className="p-4">
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${(inv.status || '').toLowerCase() === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {(inv.status || 'PENDING').toUpperCase()}
                </span>
              </td>
            </tr>
          ))
        ) : (
          <tr><td colSpan={5} className="p-4 text-center">No records found.</td></tr>
        )}
      </tbody>
    </table>
  )
}
