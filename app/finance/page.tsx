'use client'
import { Sidebar } from '@/components/Sidebar'
import { FinanceTable } from '@/components/FinanceTable'

export default function FinancePage() {
  return (
    <div className="flex bg-gray-50 min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Finance & Accounting</h1>
        </header>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
           <FinanceTable />
        </div>
      </main>
    </div>
  )
}
