'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../supabase-client'

export function FinanceTable() {
  const [invoices, setInvoices] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    // Only run if supabase client was initialized correctly
    if (!supabase.from) return; 

    const fetchInvoices = async () => {
      const { data } = await supabase.from('invoices').select('*, locations(name)')
      if (data) setInvoices(data)
    }
    fetchInvoices()
  }, [])

  if (invoices.length === 0) return <p>No records found.</p>

  return (
    <table className="w-full text-left">
       {/* ... your existing table map code ... */}
       {invoices?.map(inv => (
         <tr key={inv.id}>...</tr>
       ))}
    </table>
  )
}
