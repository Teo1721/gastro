'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/app/supabase-client'

export function FinanceTable() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
    const fetchInvoices = async () => {
      const supabase = createClient()
      if (!supabase?.from) return

      try {
        const { data } = await supabase
          .from('invoices')
          .select('*, locations(name)')
          .order('service_date', { ascending: false })
        
        setInvoices(data || [])
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchInvoices()
  }, [])

  // BLOCKER: This stops the build worker from ever seeing the code below during 'npm run build'
  if (!isClient) return <div className="p-4">Loading...</div>

  return (
    <table className="w-full text-left">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr>
          <th className="p-4 text-sm">Date</th>
          <th className="p-4 text-sm">Location</th>
          <th className="p-4 text-sm">Supplier</th>
          <th className="p-4 text-sm text-right">Amount</th>
          <th className="p-4 text-sm">Status</th>
        </tr>
      </thead>
      <tbody>
        {invoices.length > 0 ? (
          invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-slate-100">
              <td className="p-4">{inv.service_date || 'N/A'}</td>
              <td className="p-4">{inv.locations?.name || 'N/A'}</td>
              <td className="p-4">{inv.supplier_name || 'N/A'}</td>
              <td className="p-4 text-right">${inv.total_amount ?? 0}</td>
              <td className="p-4">
                <span className="px-2 py-1 rounded-full text-xs font-bold">
                  {/* Notice: No .toUpperCase() or .startsWith() here to be safe */}
                  {String(inv.status || 'PENDING')}
                </span>
              </td>
            </tr>
          ))
        ) : (
          <tr><td colSpan={5} className="p-4 text-center">No records.</td></tr>
        )}
      </tbody>
    </table>
  )
}
