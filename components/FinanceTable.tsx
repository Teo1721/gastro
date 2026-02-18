'use client'
import { useEffect, useState } from 'react'
// ✅ Corrected Path based on your file location
import { createClient } from '@/app/supabase-client'

export function FinanceTable() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchInvoices = async () => {
      // Safety check: ensure supabase client was initialized
      if (!supabase || !supabase.from) {
        console.error("Supabase client failed to initialize");
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('invoices')
          .select('*, locations(name)')
          .order('service_date', { ascending: false })
        
        if (error) throw error
        if (data) setInvoices(data)
      } catch (err) {
        console.error('Error fetching:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchInvoices()
  }, [])

  if (loading) return <div className="p-4 text-slate-500">Loading records...</div>
  if (!invoices || invoices.length === 0) return <div className="p-4 text-slate-500">No records found.</div>

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
        {invoices.map(inv => (
          <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
            <td className="p-4 text-slate-600">{inv.service_date}</td>
            <td className="p-4 text-slate-600">{inv.locations?.name || 'N/A'}</td>
            <td className="p-4 font-medium text-slate-900">{inv.supplier_name}</td>
            <td className="p-4 text-right font-mono text-slate-900">${inv.total_amount}</td>
            <td className="p-4">
              <span className={`px-2 py-1 rounded-full text-xs font-bold ${(inv.status || '').toLowerCase() === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {(inv.status || 'PENDING').toUpperCase()}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
