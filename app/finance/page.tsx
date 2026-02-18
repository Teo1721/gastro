export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { Sidebar } from '@/components/Sidebar'
import { FinanceTable } from '@/components/FinanceTable'

export default function FinancePage() {
  return (
    <div className="flex bg-gray-50 min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
         <FinanceTable />
      </main>
    </div>
  )
}
