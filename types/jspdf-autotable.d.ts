import 'jspdf'

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF
  }
}

declare module 'jspdf-autotable' {
  const autoTable: (doc: any, options: any) => void
  export default autoTable
}
