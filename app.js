/* =============================================================
 * Household Finance / Finanzas del Hogar — app.js
 *
 * A dependency-free, offline-first budgeting app.
 *
 * Architecture (module pattern, clean layers):
 *   • I18n    — every user-visible string, in English and Spanish
 *   • Utils   — small pure helpers (dates, numbers, escaping)
 *   • Store   — the ONLY code that talks to localStorage
 *   • Model   — data shape, defaults, migrations, CRUD
 *   • Calc    — pure business logic / derived numbers
 *   • UI      — Money, Toast, Modal, Form: presentation primitives
 *   • Render  — turns state into DOM
 *   • App     — wiring, events, bootstrap
 *
 * Data shape (schema 2):
 * {
 *   schema: 2,
 *   settings: { currency: "GTQ", theme: "light"|"dark"|null, language: "es"|"en"|null },
 *   months: {
 *     "2026-09": {
 *       income:      [{ id, name, planned, actual, note }],
 *       categories:  [{ id, name, planned, note }],
 *       allocations: [{ id, name, planned, actual, note }],
 *       transactions:[{ id, date, type, refId, description, amount, createdAt }]
 *     }
 *   },
 *   updatedAt: "ISO string"
 * }
 *
 * Actual amounts:
 *   • Category actual   = sum of its expense transactions (always derived)
 *   • Income actual     = the source's recorded "actual" + its income transactions
 *   • Allocation actual = the allocation's recorded "actual" + its allocation transactions
 * ============================================================= */

(function () {
  'use strict';

  /* ===========================================================
   * 1. I18N — all user-visible copy lives here and nowhere else
   *
   * A value is either a string with {placeholders} or a function
   * of the params object (used for plurals and gender agreement).
   * =========================================================== */
  const I18n = (() => {
    const LOCALES = { en: 'en-US', es: 'es-GT' };

    const EN = {
      /* --- shell --- */
      'app.title': 'Household Finance',
      'app.tagline': 'Saved locally on this device',
      'app.storageBlocked': 'Storage blocked — changes will not be kept',
      'app.skip': 'Skip to main content',

      'nav.monthNav': 'Month navigation',
      'nav.prev': 'Previous month',
      'nav.next': 'Next month',
      'nav.selectMonth': 'Select month',
      'nav.today': 'Today',
      'nav.sections': 'Sections',

      'lang.switch': 'Cambiar a español',
      'theme.toDark': 'Switch to dark mode',
      'theme.toLight': 'Switch to light mode',

      'tab.dashboard': 'Dashboard',
      'tab.income': 'Income',
      'tab.budget': 'Budget',
      'tab.allocations': 'Allocations',
      'tab.transactions': 'Transactions',

      'menu.data': 'Data',
      'menu.export': 'Export backup (JSON)',
      'menu.import': 'Import backup…',
      'menu.copyPrev': 'Copy plan from previous month',
      'menu.seedDefaults': 'Add starter categories',
      'menu.settings': 'Settings',
      'menu.clearMonth': 'Clear this month',
      'menu.resetAll': 'Delete all data',

      'modal.close': 'Close dialog',

      /* --- generic actions --- */
      'action.edit': 'Edit',
      'action.delete': 'Delete',
      'action.cancel': 'Cancel',
      'action.save': 'Save',
      'action.saveChanges': 'Save changes',
      'action.manage': 'Manage',
      'action.viewAll': 'View all',
      'action.reset': 'Reset',
      'action.addTransaction': 'Add transaction',

      /* --- dashboard --- */
      'dash.planActual': 'Planned vs. actual',
      'dash.categoryHealth': 'Category health',
      'dash.allocProgress': 'Allocation progress',
      'dash.recent': 'Recent activity',

      'tile.income': 'Income received',
      'tile.spent': 'Spent',
      'tile.allocated': 'Allocated',
      'tile.unallocated': 'Unallocated',
      'tile.planned': 'Planned {amount}',
      'tile.vsPlan': '{amount} vs plan',
      'tile.budget': 'Budget {amount}',
      'tile.left': '{amount} left',
      'tile.over': '{amount} over',
      'tile.target': 'Target {amount}',
      'tile.toGo': '{amount} to go',
      'tile.fullyFunded': 'Fully funded',
      'tile.overcommitted': 'Overcommitted',
      'tile.available': 'Available',

      'compare.income': 'Income',
      'compare.expenses': 'Expenses',
      'compare.allocations': 'Allocations',
      'compare.of': '{actual} of {planned}',
      'common.of': 'of {amount}',

      'status.over': 'Over · {pct}%',
      'status.close': 'Close · {pct}%',
      'status.onTrack': 'On track · {pct}%',
      'status.noBudget': 'No budget set',

      /* --- categories --- */
      'cat.overBudget': '{amount} over budget',
      'cat.remaining': '{amount} remaining',
      'cat.leftToSpend': '{amount} left to spend',
      'cat.txCount': (p) => p.n + (p.n === 1 ? ' transaction' : ' transactions'),
      'cat.uncategorised': 'Uncategorised',

      /* --- income --- */
      'income.title': 'Income sources',
      'income.sub': 'Combined household income for {month}.',
      'income.addBtn': '+ Add income',
      'income.received': '{pct}% received',
      'income.plannedIs': 'Planned {amount}',
      'income.breakdown': 'recorded {recorded} + logged {logged}',
      'income.vsPlan': '{amount} vs plan',
      'income.footPlanned': 'Planned',
      'income.footReceived': 'Received',
      'income.footDifference': 'Difference',

      /* --- budget --- */
      'budget.title': 'Budget categories',
      'budget.sub': 'Actual spending is calculated from your logged expense transactions.',
      'budget.addBtn': '+ Add category',
      'budget.footBudgeted': 'Budgeted',
      'budget.footSpent': 'Spent',
      'budget.footLeft': 'Left',
      'budget.footOver': 'Over',
      'budget.useStarter': 'Use starter set',

      /* --- allocations --- */
      'alloc.title': 'Allocations',
      'alloc.sub': 'Savings, emergency fund, debt payments and investments.',
      'alloc.addBtn': '+ Add allocation',
      'alloc.funded': 'Funded',
      'alloc.stillToSet': '{amount} still to set aside',
      'alloc.targetMet': 'Target met',
      'alloc.includesLogged': 'includes {amount} logged',
      'alloc.footTarget': 'Target',
      'alloc.footFunded': 'Funded',
      'alloc.footRemaining': 'Remaining',

      /* --- transactions --- */
      'tx.title': 'Transactions',
      'tx.addBtn': '+ Add transaction',
      'tx.searchLabel': 'Search transactions',
      'tx.searchPlaceholder': 'Search description…',
      'tx.filterTypeLabel': 'Filter by type',
      'tx.filterCatLabel': 'Filter by category',
      'tx.allTypes': 'All types',
      'tx.allCategories': 'All categories',
      'tx.unassigned': 'Unassigned',
      'tx.typeExpense': 'Expense',
      'tx.typeIncome': 'Income',
      'tx.typeAllocation': 'Allocation',
      'tx.typeExpensePlural': 'Expenses',
      'tx.typeIncomePlural': 'Income',
      'tx.typeAllocationPlural': 'Allocations',
      'tx.count': (p) => p.shown + ' of ' + p.total + (p.total === 1 ? ' transaction in ' : ' transactions in ') + p.month,
      'tx.none': 'Nothing logged in {month} yet',
      'tx.caption': 'Transactions for {month}',
      'tx.deleteAria': 'Delete transaction',
      'tx.footExpenses': 'Expenses',
      'tx.footIncome': 'Income',
      'tx.footAllocations': 'Allocations',

      /* --- empty states --- */
      'empty.nothingPlanned.title': 'Nothing planned yet',
      'empty.nothingPlanned.text': 'Add income and budget categories to see how {month} is tracking.',
      'empty.nothingPlanned.addIncome': 'Add income',
      'empty.nothingPlanned.addCategory': 'Add a category',
      'empty.noBudgets.title': 'No budgets set',
      'empty.noBudgets.text': 'Set a budget limit on a category to track spending against it.',
      'empty.noAllocs.title': 'No allocations yet',
      'empty.noAllocs.text': 'Set targets for savings, debt payments or investments.',
      'empty.noAllocsLong.text': 'Track where the leftover money goes: savings, emergency fund, debt payments and investments.',
      'empty.noTx.title': 'No transactions yet',
      'empty.noTx.dashText': 'Nothing logged for {month} yet. Add your first one to get started.',
      'empty.noTx.text': 'No transactions yet for {month}. Tap “+” to add one.',
      'empty.noIncome.title': 'No income sources yet',
      'empty.noIncome.text': 'Add salaries, freelance work or any other money coming in during {month}.',
      'empty.noIncome.btn': 'Add income source',
      'empty.noCats.title': 'No budget categories yet',
      'empty.noCats.text': 'Create categories such as Housing or Groceries, then give each one a monthly limit.',
      'empty.noCats.btn': 'Add category',
      'empty.noMatches.title': 'No matches',
      'empty.noMatches.text': 'No transactions match the current filters. Try clearing the search or filters.',
      'empty.noMatches.btn': 'Reset filters',
      'empty.copyPlanFrom': 'Copy plan from {month}',
      'empty.addAllocation': 'Add allocation',
      'empty.addTransaction': 'Add transaction',

      /* --- forms --- */
      'form.income.add': 'Add income source',
      'form.income.edit': 'Edit income source',
      'form.income.submitAdd': 'Add income',
      'form.field.sourceName': 'Source name',
      'form.hint.sourceName': 'Household income only; no need to say whose it is.',
      'form.ph.sourceName': 'e.g. Salary — Acme Corp',
      'form.field.plannedAmount': 'Planned amount',
      'form.hint.plannedAmount': 'What you expect to receive this month.',
      'form.field.actualReceived': 'Actually received',
      'form.hint.actualReceived': 'Income transactions you log are added on top of this.',
      'form.field.note': 'Note (optional)',

      'form.category.add': 'Add budget category',
      'form.category.edit': 'Edit category',
      'form.category.submitAdd': 'Add category',
      'form.field.categoryName': 'Category name',
      'form.ph.categoryName': 'e.g. Groceries',
      'form.field.monthlyBudget': 'Monthly budget',
      'form.hint.monthlyBudget': 'Spending is tracked from your transactions.',
      'form.intro.spent': (p) => 'Spent so far: ' + p.amount + ' across ' + p.n +
        (p.n === 1 ? ' transaction.' : ' transactions.'),
      'form.err.duplicateCategory': 'A category with that name already exists this month.',

      'form.allocation.add': 'Add allocation',
      'form.allocation.edit': 'Edit allocation',
      'form.allocation.submitAdd': 'Add allocation',
      'form.field.allocName': 'Allocation name',
      'form.ph.allocName': 'e.g. Emergency Fund',
      'form.field.targetMonth': 'Target this month',
      'form.field.setAside': 'Set aside so far',
      'form.hint.setAside': 'Allocation transactions are added on top of this.',

      'form.tx.add': 'Add transaction',
      'form.tx.edit': 'Edit transaction',
      'form.tx.submitAdd': 'Add transaction',
      'form.field.description': 'Description',
      'form.ph.description': 'e.g. Weekly grocery run',
      'form.field.type': 'Type',
      'form.field.amount': 'Amount',
      'form.field.date': 'Date',
      'form.field.refCategory': 'Category',
      'form.field.refIncome': 'Income source',
      'form.field.refAllocation': 'Allocation',
      'form.hint.refExpense': 'Spending counts towards this category’s budget.',
      'form.hint.refIncome': 'Adds to what this source has received.',
      'form.hint.refAllocation': 'Counts towards this allocation’s target.',
      'form.hint.date': 'Must fall inside {month}.',
      'form.opt.uncategorised': '— Uncategorised —',
      'form.opt.unassigned': '— Unassigned —',

      /* --- validation --- */
      'valid.required': '{label} is required.',
      'valid.invalidAmount': 'Enter a valid amount, for example 1250.00.',
      'valid.minAmount': '{label} cannot be less than {amount}.',
      'valid.maxAmount': '{label} cannot be more than {amount}.',
      'valid.invalidDate': 'Enter a valid date.',
      'valid.dateRange': 'Pick a date inside {month}. Switch months to log it elsewhere.',
      'valid.checkField': 'Please check {label}.',
      'valid.summary': 'Please fix the {n} highlighted fields.',
      'valid.generic': 'Something went wrong. Please try again.',

      /* --- confirmations --- */
      'kind.income': 'income source',
      'kind.category': 'category',
      'kind.allocation': 'allocation',
      'kind.transaction': 'transaction',
      'confirm.delete.title': 'Delete {kind}',
      'confirm.delete.msg': 'Delete “{name}” from {month}? This cannot be undone.',
      'confirm.delete.linked': (p) => ' ' + p.n + (p.n === 1 ? ' transaction' : ' transactions') +
        ' will be kept but marked as unassigned.',
      'confirm.delete.btn': 'Delete',
      'confirm.copy.title': 'Copy plan forward',
      'confirm.copy.msg': 'Copy income sources, budget limits and allocation targets from {from} into {to}? ' +
        'Existing plan entries for {to} will be replaced. Transactions are not copied.',
      'confirm.copy.btn': 'Copy plan',
      'confirm.clear.title': 'Clear this month',
      'confirm.clear.msg': 'Remove all income, categories, allocations and transactions for {month}? ' +
        'Other months are not affected. This cannot be undone.',
      'confirm.clear.btn': 'Clear month',
      'confirm.reset.title': 'Delete all data',
      'confirm.reset.msg': 'This permanently deletes every month stored in this browser. ' +
        'Export a backup first if you might want it back. Continue?',
      'confirm.reset.btn': 'Delete everything',

      /* --- settings & backup --- */
      'settings.title': 'Settings',
      'settings.intro': 'Everything is stored in this browser only. Nothing is uploaded anywhere.',
      'settings.currency': 'Currency',
      'settings.currencyHint': 'Amounts are formatted for the selected language.',
      'settings.language': 'Language',
      'settings.languageHint': 'Changes every label in the app straight away.',
      'settings.submit': 'Save settings',
      'settings.langEn': 'English',
      'settings.langEs': 'Spanish (español)',

      'import.title': 'Restore backup',
      'import.intro': (p) => 'This backup contains ' + p.n + (p.n === 1 ? ' month' : ' months') +
        ' of data. Export your current data first if you want to keep it.',
      'import.mode': 'How should it be applied?',
      'import.replace': 'Replace — delete everything and use the backup',
      'import.merge': 'Merge — keep my months, overwrite ones in the backup',
      'import.submit': 'Restore',

      /* --- toasts --- */
      'toast.incomeAdded': 'Income source added.',
      'toast.incomeUpdated': 'Income source updated.',
      'toast.categoryAdded': 'Category added.',
      'toast.categoryUpdated': 'Category updated.',
      'toast.allocationAdded': 'Allocation added.',
      'toast.allocationUpdated': 'Allocation updated.',
      'toast.txAdded': 'Transaction added.',
      'toast.txUpdated': 'Transaction updated.',
      'toast.deleted': '{kind} deleted.',
      'toast.planCopied': 'Plan copied from {month}.',
      'toast.monthCleared': '{month} cleared.',
      'toast.allDeleted': 'All data deleted.',
      'toast.settingsSaved': 'Settings saved.',
      'toast.starterAdded': 'Starter categories and allocations added.',
      'toast.backupDownloaded': 'Backup downloaded.',
      'toast.backupRestored': (p) => 'Backup restored — ' + p.n + (p.n === 1 ? ' month' : ' months') + ' loaded.',
      'toast.otherTab': 'Updated with changes from another tab.',

      /* --- errors --- */
      'err.storageFull': 'Storage is full — export a backup and remove old months.',
      'err.storageWrite': 'Changes could not be saved to this browser.',
      'err.storageBlocked': 'This browser is blocking local storage, so your data cannot be saved. ' +
        'Check your privacy settings, and export a backup before closing the tab.',
      'err.itemGone': 'That item no longer exists.',
      'err.noDataIn': 'There is no data in {month}.',
      'err.exportFailed': 'Could not create the backup file.',
      'err.fileRead': 'The file could not be read.',
      'err.fileTooLarge': 'That file is too large to be a backup.',
      'err.invalidJson': 'That file is not valid JSON.',
      'err.notBackup': 'That file is not a Household Finance backup.',
      'err.noMonths': 'The backup contains no months of data.',
      'err.nothingToCopy': 'There is nothing to copy from {month}.',

      /* --- seeded data + fallback names --- */
      'seed.housing': 'Housing',
      'seed.groceries': 'Groceries',
      'seed.transportation': 'Transportation',
      'seed.utilities': 'Utilities',
      'seed.entertainment': 'Entertainment',
      'seed.health': 'Health & Medical',
      'seed.personal': 'Personal & Shopping',
      'seed.misc': 'Miscellaneous',
      'seed.savings': 'Savings',
      'seed.emergency': 'Emergency Fund',
      'seed.debt': 'Debt Payments',
      'seed.investments': 'Investments',
      'fallback.income': 'Income',
      'fallback.category': 'Category',
      'fallback.allocation': 'Allocation',
      'fallback.transaction': 'Transaction'
    };

    const ES = {
      /* --- shell --- */
      'app.title': 'Finanzas del Hogar',
      'app.tagline': 'Guardado localmente en este dispositivo',
      'app.storageBlocked': 'Almacenamiento bloqueado — los cambios no se guardarán',
      'app.skip': 'Saltar al contenido principal',

      'nav.monthNav': 'Navegación por mes',
      'nav.prev': 'Mes anterior',
      'nav.next': 'Mes siguiente',
      'nav.selectMonth': 'Seleccionar mes',
      'nav.today': 'Hoy',
      'nav.sections': 'Secciones',

      'lang.switch': 'Switch to English',
      'theme.toDark': 'Cambiar a modo oscuro',
      'theme.toLight': 'Cambiar a modo claro',

      'tab.dashboard': 'Resumen',
      'tab.income': 'Ingresos',
      'tab.budget': 'Presupuesto',
      'tab.allocations': 'Asignaciones',
      'tab.transactions': 'Transacciones',

      'menu.data': 'Datos',
      'menu.export': 'Exportar respaldo (JSON)',
      'menu.import': 'Importar respaldo…',
      'menu.copyPrev': 'Copiar plan del mes anterior',
      'menu.seedDefaults': 'Agregar categorías iniciales',
      'menu.settings': 'Configuración',
      'menu.clearMonth': 'Limpiar este mes',
      'menu.resetAll': 'Borrar todos los datos',

      'modal.close': 'Cerrar diálogo',

      /* --- generic actions --- */
      'action.edit': 'Editar',
      'action.delete': 'Eliminar',
      'action.cancel': 'Cancelar',
      'action.save': 'Guardar',
      'action.saveChanges': 'Guardar cambios',
      'action.manage': 'Gestionar',
      'action.viewAll': 'Ver todo',
      'action.reset': 'Restablecer',
      'action.addTransaction': 'Agregar transacción',

      /* --- dashboard --- */
      'dash.planActual': 'Planificado vs. real',
      'dash.categoryHealth': 'Estado de categorías',
      'dash.allocProgress': 'Progreso de asignaciones',
      'dash.recent': 'Actividad reciente',

      'tile.income': 'Ingreso recibido',
      'tile.spent': 'Gastado',
      'tile.allocated': 'Asignado',
      'tile.unallocated': 'Sin asignar',
      'tile.planned': 'Planificado {amount}',
      'tile.vsPlan': '{amount} vs. plan',
      'tile.budget': 'Presupuesto {amount}',
      'tile.left': 'Quedan {amount}',
      'tile.over': '{amount} de más',
      'tile.target': 'Meta {amount}',
      'tile.toGo': 'Faltan {amount}',
      'tile.fullyFunded': 'Meta completa',
      'tile.overcommitted': 'Sobrecomprometido',
      'tile.available': 'Disponible',

      'compare.income': 'Ingresos',
      'compare.expenses': 'Gastos',
      'compare.allocations': 'Asignaciones',
      'compare.of': '{actual} de {planned}',
      'common.of': 'de {amount}',

      'status.over': 'Excedido · {pct}%',
      'status.close': 'Cerca · {pct}%',
      'status.onTrack': 'En orden · {pct}%',
      'status.noBudget': 'Sin presupuesto',

      /* --- categories --- */
      'cat.overBudget': '{amount} sobre el presupuesto',
      'cat.remaining': 'Quedan {amount}',
      'cat.leftToSpend': 'Quedan {amount} por gastar',
      'cat.txCount': (p) => p.n + (p.n === 1 ? ' transacción' : ' transacciones'),
      'cat.uncategorised': 'Sin categoría',

      /* --- income --- */
      'income.title': 'Fuentes de ingreso',
      'income.sub': 'Ingreso combinado del hogar para {month}.',
      'income.addBtn': '+ Agregar ingreso',
      'income.received': '{pct}% recibido',
      'income.plannedIs': 'Planificado {amount}',
      'income.breakdown': 'registrado {recorded} + anotado {logged}',
      'income.vsPlan': '{amount} vs. plan',
      'income.footPlanned': 'Planificado',
      'income.footReceived': 'Recibido',
      'income.footDifference': 'Diferencia',

      /* --- budget --- */
      'budget.title': 'Categorías de presupuesto',
      'budget.sub': 'El gasto real se calcula a partir de las transacciones de gasto registradas.',
      'budget.addBtn': '+ Agregar categoría',
      'budget.footBudgeted': 'Presupuestado',
      'budget.footSpent': 'Gastado',
      'budget.footLeft': 'Disponible',
      'budget.footOver': 'Excedido',
      'budget.useStarter': 'Usar conjunto inicial',

      /* --- allocations --- */
      'alloc.title': 'Asignaciones',
      'alloc.sub': 'Ahorros, fondo de emergencia, pago de deudas e inversiones.',
      'alloc.addBtn': '+ Agregar asignación',
      'alloc.funded': 'Completa',
      'alloc.stillToSet': 'Faltan {amount} por apartar',
      'alloc.targetMet': 'Meta alcanzada',
      'alloc.includesLogged': 'incluye {amount} anotado',
      'alloc.footTarget': 'Meta',
      'alloc.footFunded': 'Apartado',
      'alloc.footRemaining': 'Restante',

      /* --- transactions --- */
      'tx.title': 'Transacciones',
      'tx.addBtn': '+ Agregar transacción',
      'tx.searchLabel': 'Buscar transacciones',
      'tx.searchPlaceholder': 'Buscar descripción…',
      'tx.filterTypeLabel': 'Filtrar por tipo',
      'tx.filterCatLabel': 'Filtrar por categoría',
      'tx.allTypes': 'Todos los tipos',
      'tx.allCategories': 'Todas las categorías',
      'tx.unassigned': 'Sin asignar',
      'tx.typeExpense': 'Gasto',
      'tx.typeIncome': 'Ingreso',
      'tx.typeAllocation': 'Asignación',
      'tx.typeExpensePlural': 'Gastos',
      'tx.typeIncomePlural': 'Ingresos',
      'tx.typeAllocationPlural': 'Asignaciones',
      'tx.count': (p) => p.shown + ' de ' + p.total +
        (p.total === 1 ? ' transacción en ' : ' transacciones en ') + p.month,
      'tx.none': 'Aún no hay nada registrado en {month}',
      'tx.caption': 'Transacciones de {month}',
      'tx.deleteAria': 'Eliminar transacción',
      'tx.footExpenses': 'Gastos',
      'tx.footIncome': 'Ingresos',
      'tx.footAllocations': 'Asignaciones',

      /* --- empty states --- */
      'empty.nothingPlanned.title': 'Aún no hay nada planificado',
      'empty.nothingPlanned.text': 'Agregá ingresos y categorías de presupuesto para ver cómo va {month}.',
      'empty.nothingPlanned.addIncome': 'Agregar ingreso',
      'empty.nothingPlanned.addCategory': 'Agregar una categoría',
      'empty.noBudgets.title': 'Sin presupuestos definidos',
      'empty.noBudgets.text': 'Poné un límite mensual a una categoría para darle seguimiento al gasto.',
      'empty.noAllocs.title': 'Aún no hay asignaciones',
      'empty.noAllocs.text': 'Definí metas para ahorros, pago de deudas o inversiones.',
      'empty.noAllocsLong.text': 'Llevá el control de a dónde va el dinero restante: ahorros, fondo de emergencia, pago de deudas e inversiones.',
      'empty.noTx.title': 'Aún no hay transacciones',
      'empty.noTx.dashText': 'Todavía no hay nada registrado en {month}. Agregá la primera para empezar.',
      'empty.noTx.text': 'Aún no hay transacciones en {month}. Tocá “+” para agregar una.',
      'empty.noIncome.title': 'Aún no hay fuentes de ingreso',
      'empty.noIncome.text': 'Agregá salarios, trabajos independientes o cualquier otro dinero que entre durante {month}.',
      'empty.noIncome.btn': 'Agregar fuente de ingreso',
      'empty.noCats.title': 'Aún no hay categorías de presupuesto',
      'empty.noCats.text': 'Creá categorías como Vivienda o Supermercado y asignale a cada una un límite mensual.',
      'empty.noCats.btn': 'Agregar categoría',
      'empty.noMatches.title': 'Sin resultados',
      'empty.noMatches.text': 'Ninguna transacción coincide con los filtros actuales. Probá limpiando la búsqueda o los filtros.',
      'empty.noMatches.btn': 'Restablecer filtros',
      'empty.copyPlanFrom': 'Copiar plan de {month}',
      'empty.addAllocation': 'Agregar asignación',
      'empty.addTransaction': 'Agregar transacción',

      /* --- forms --- */
      'form.income.add': 'Agregar fuente de ingreso',
      'form.income.edit': 'Editar fuente de ingreso',
      'form.income.submitAdd': 'Agregar ingreso',
      'form.field.sourceName': 'Nombre de la fuente',
      'form.hint.sourceName': 'Solo ingreso del hogar; no hace falta decir de quién es.',
      'form.ph.sourceName': 'p. ej. Salario — Empresa S.A.',
      'form.field.plannedAmount': 'Monto planificado',
      'form.hint.plannedAmount': 'Lo que esperás recibir este mes.',
      'form.field.actualReceived': 'Recibido realmente',
      'form.hint.actualReceived': 'Las transacciones de ingreso que registrés se suman a esto.',
      'form.field.note': 'Nota (opcional)',

      'form.category.add': 'Agregar categoría de presupuesto',
      'form.category.edit': 'Editar categoría',
      'form.category.submitAdd': 'Agregar categoría',
      'form.field.categoryName': 'Nombre de la categoría',
      'form.ph.categoryName': 'p. ej. Supermercado',
      'form.field.monthlyBudget': 'Presupuesto mensual',
      'form.hint.monthlyBudget': 'El gasto se calcula desde tus transacciones.',
      'form.intro.spent': (p) => 'Gastado hasta ahora: ' + p.amount + ' en ' + p.n +
        (p.n === 1 ? ' transacción.' : ' transacciones.'),
      'form.err.duplicateCategory': 'Ya existe una categoría con ese nombre este mes.',

      'form.allocation.add': 'Agregar asignación',
      'form.allocation.edit': 'Editar asignación',
      'form.allocation.submitAdd': 'Agregar asignación',
      'form.field.allocName': 'Nombre de la asignación',
      'form.ph.allocName': 'p. ej. Fondo de emergencia',
      'form.field.targetMonth': 'Meta de este mes',
      'form.field.setAside': 'Apartado hasta ahora',
      'form.hint.setAside': 'Las transacciones de asignación se suman a esto.',

      'form.tx.add': 'Agregar transacción',
      'form.tx.edit': 'Editar transacción',
      'form.tx.submitAdd': 'Agregar transacción',
      'form.field.description': 'Descripción',
      'form.ph.description': 'p. ej. Compra semanal del súper',
      'form.field.type': 'Tipo',
      'form.field.amount': 'Monto',
      'form.field.date': 'Fecha',
      'form.field.refCategory': 'Categoría',
      'form.field.refIncome': 'Fuente de ingreso',
      'form.field.refAllocation': 'Asignación',
      'form.hint.refExpense': 'El gasto cuenta contra el presupuesto de esta categoría.',
      'form.hint.refIncome': 'Se suma a lo que ya recibió esta fuente.',
      'form.hint.refAllocation': 'Cuenta para la meta de esta asignación.',
      'form.hint.date': 'Debe estar dentro de {month}.',
      'form.opt.uncategorised': '— Sin categoría —',
      'form.opt.unassigned': '— Sin asignar —',

      /* --- validation --- */
      /* Phrased around "el campo" so it agrees regardless of the label's gender. */
      'valid.required': 'El campo {label} es obligatorio.',
      'valid.invalidAmount': 'Ingresá un monto válido, por ejemplo 1250.00.',
      'valid.minAmount': '{label} no puede ser menor que {amount}.',
      'valid.maxAmount': '{label} no puede ser mayor que {amount}.',
      'valid.invalidDate': 'Ingresá una fecha válida.',
      'valid.dateRange': 'Elegí una fecha dentro de {month}. Cambiá de mes para registrarla en otro.',
      'valid.checkField': 'Revisá el campo {label}.',
      'valid.summary': 'Corregí los {n} campos marcados.',
      'valid.generic': 'Algo salió mal. Intentá de nuevo.',

      /* --- confirmations --- */
      'kind.income': 'fuente de ingreso',
      'kind.category': 'categoría',
      'kind.allocation': 'asignación',
      'kind.transaction': 'transacción',
      'confirm.delete.title': 'Eliminar {kind}',
      'confirm.delete.msg': '¿Eliminar “{name}” de {month}? Esta acción no se puede deshacer.',
      'confirm.delete.linked': (p) => ' ' + p.n + (p.n === 1 ? ' transacción se conservará' : ' transacciones se conservarán') +
        ', pero quedarán sin asignar.',
      'confirm.delete.btn': 'Eliminar',
      'confirm.copy.title': 'Copiar el plan al mes actual',
      'confirm.copy.msg': '¿Copiar las fuentes de ingreso, los límites de presupuesto y las metas de asignación de {from} a {to}? ' +
        'Lo que ya exista en el plan de {to} será reemplazado. Las transacciones no se copian.',
      'confirm.copy.btn': 'Copiar plan',
      'confirm.clear.title': 'Limpiar este mes',
      'confirm.clear.msg': '¿Eliminar todos los ingresos, categorías, asignaciones y transacciones de {month}? ' +
        'Los demás meses no se ven afectados. Esta acción no se puede deshacer.',
      'confirm.clear.btn': 'Limpiar mes',
      'confirm.reset.title': 'Borrar todos los datos',
      'confirm.reset.msg': 'Esto elimina de forma permanente todos los meses guardados en este navegador. ' +
        'Exportá un respaldo antes si creés que lo vas a necesitar. ¿Continuar?',
      'confirm.reset.btn': 'Borrar todo',

      /* --- settings & backup --- */
      'settings.title': 'Configuración',
      'settings.intro': 'Todo se guarda solo en este navegador. Nada se sube a ningún servidor.',
      'settings.currency': 'Moneda',
      'settings.currencyHint': 'Los montos se formatean según el idioma seleccionado.',
      'settings.language': 'Idioma',
      'settings.languageHint': 'Cambia de inmediato todas las etiquetas de la aplicación.',
      'settings.submit': 'Guardar configuración',
      'settings.langEn': 'Inglés (English)',
      'settings.langEs': 'Español',

      'import.title': 'Restaurar respaldo',
      'import.intro': (p) => 'Este respaldo contiene ' + p.n + (p.n === 1 ? ' mes' : ' meses') +
        ' de datos. Exportá tus datos actuales primero si querés conservarlos.',
      'import.mode': '¿Cómo querés aplicarlo?',
      'import.replace': 'Reemplazar — borrar todo y usar el respaldo',
      'import.merge': 'Combinar — conservar mis meses y sobrescribir los del respaldo',
      'import.submit': 'Restaurar',

      /* --- toasts --- */
      'toast.incomeAdded': 'Fuente de ingreso agregada.',
      'toast.incomeUpdated': 'Fuente de ingreso actualizada.',
      'toast.categoryAdded': 'Categoría agregada.',
      'toast.categoryUpdated': 'Categoría actualizada.',
      'toast.allocationAdded': 'Asignación agregada.',
      'toast.allocationUpdated': 'Asignación actualizada.',
      'toast.txAdded': 'Transacción agregada.',
      'toast.txUpdated': 'Transacción actualizada.',
      'toast.deleted': 'Se eliminó: {kind}.',
      'toast.planCopied': 'Plan copiado de {month}.',
      'toast.monthCleared': '{month} quedó limpio.',
      'toast.allDeleted': 'Se borraron todos los datos.',
      'toast.settingsSaved': 'Configuración guardada.',
      'toast.starterAdded': 'Se agregaron las categorías y asignaciones iniciales.',
      'toast.backupDownloaded': 'Respaldo descargado.',
      'toast.backupRestored': (p) => 'Respaldo restaurado — se cargaron ' + p.n + (p.n === 1 ? ' mes.' : ' meses.'),
      'toast.otherTab': 'Se aplicaron los cambios hechos en otra pestaña.',

      /* --- errors --- */
      'err.storageFull': 'El almacenamiento está lleno — exportá un respaldo y eliminá meses viejos.',
      'err.storageWrite': 'No se pudieron guardar los cambios en este navegador.',
      'err.storageBlocked': 'Este navegador está bloqueando el almacenamiento local, así que tus datos no se pueden guardar. ' +
        'Revisá tu configuración de privacidad y exportá un respaldo antes de cerrar la pestaña.',
      'err.itemGone': 'Ese elemento ya no existe.',
      'err.noDataIn': 'No hay datos en {month}.',
      'err.exportFailed': 'No se pudo crear el archivo de respaldo.',
      'err.fileRead': 'No se pudo leer el archivo.',
      'err.fileTooLarge': 'Ese archivo es demasiado grande para ser un respaldo.',
      'err.invalidJson': 'Ese archivo no es JSON válido.',
      'err.notBackup': 'Ese archivo no es un respaldo de Finanzas del Hogar.',
      'err.noMonths': 'El respaldo no contiene ningún mes de datos.',
      'err.nothingToCopy': 'No hay nada que copiar de {month}.',

      /* --- seeded data + fallback names --- */
      'seed.housing': 'Vivienda',
      'seed.groceries': 'Supermercado',
      'seed.transportation': 'Transporte',
      'seed.utilities': 'Servicios',
      'seed.entertainment': 'Entretenimiento',
      'seed.health': 'Salud y medicina',
      'seed.personal': 'Personal y compras',
      'seed.misc': 'Varios',
      'seed.savings': 'Ahorros',
      'seed.emergency': 'Fondo de emergencia',
      'seed.debt': 'Pago de deudas',
      'seed.investments': 'Inversiones',
      'fallback.income': 'Ingreso',
      'fallback.category': 'Categoría',
      'fallback.allocation': 'Asignación',
      'fallback.transaction': 'Transacción'
    };

    const DICT = { en: EN, es: ES };
    let lang = 'es';

    /** Look up a key, interpolate {placeholders}, fall back to English. */
    function t(key, params) {
      const table = DICT[lang] || EN;
      let entry = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : EN[key];
      if (entry == null) {
        console.warn('[i18n] Missing translation key:', key);
        return key;
      }
      if (typeof entry === 'function') return entry(params || {});
      return String(entry).replace(/\{(\w+)\}/g, (match, name) =>
        (params && params[name] != null) ? params[name] : match);
    }

    function setLanguage(next) {
      lang = DICT[next] ? next : 'en';
      document.documentElement.setAttribute('lang', lang);
      return lang;
    }

    function language() { return lang; }
    function other() { return lang === 'en' ? 'es' : 'en'; }
    function locale() { return LOCALES[lang] || 'en-US'; }

    /** Best guess from the browser, used until the user picks one. */
    function detect() {
      const tags = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language || 'en'];
      for (let i = 0; i < tags.length; i++) {
        const base = String(tags[i]).toLowerCase().split('-')[0];
        if (DICT[base]) return base;
      }
      return 'en';
    }

    /**
     * Translate static markup. Elements opt in with:
     *   data-i18n             → textContent
     *   data-i18n-aria        → aria-label
     *   data-i18n-title       → title
     *   data-i18n-placeholder → placeholder
     */
    function applyStatic(root) {
      const scope = root || document;
      scope.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.getAttribute('data-i18n'));
      });
      scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
        el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
      });
      scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
        el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
      });
      scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
      });
    }

    return { t, setLanguage, language, other, locale, detect, applyStatic, available: Object.keys(DICT) };
  })();

  const t = I18n.t;

  /* ===========================================================
   * 2. UTILS
   * =========================================================== */
  const Utils = (() => {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));

    /** Unique id, with a fallback for browsers without crypto.randomUUID. */
    function uid(prefix) {
      const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
        + '-' + Date.now().toString(36);
      return (prefix || 'id') + '_' + rand;
    }

    /** Escape text before it is injected through innerHTML. */
    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /** Round to cents, avoiding float drift such as 0.1 + 0.2. */
    function round2(n) {
      return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }

    /** Accepts "1,234.50", "Q1234.5", " 12 " → Number. Returns NaN when invalid. */
    function parseAmount(raw) {
      if (typeof raw === 'number') return isFinite(raw) ? round2(raw) : NaN;
      const cleaned = String(raw == null ? '' : raw).replace(/[\s,_]/g, '').replace(/[^\d.\-]/g, '');
      if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
      const n = Number(cleaned);
      return isFinite(n) ? round2(n) : NaN;
    }

    function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

    function capitalise(text) {
      const s = String(text || '');
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    /* ---------- Month / date helpers (all local time, no UTC drift) ---------- */

    function pad2(n) { return String(n).padStart(2, '0'); }

    /** "YYYY-MM" for a Date (defaults to today). */
    function monthKey(date) {
      const d = date || new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    }

    /** "YYYY-MM-DD" for a Date (defaults to today). */
    function dateKey(date) {
      const d = date || new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function isMonthKey(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)); }
    function isDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)); }

    /** Shift a month key by N months (negative goes back). */
    function shiftMonth(key, delta) {
      const parts = key.split('-');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
      return monthKey(d);
    }

    function daysInMonth(key) {
      const parts = key.split('-');
      return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    }

    function monthStart(key) { return key + '-01'; }
    function monthEnd(key) { return key + '-' + pad2(daysInMonth(key)); }

    /** "September 2026" / "Septiembre de 2026" — always capitalised for UI use. */
    function monthLabel(key) {
      const parts = key.split('-');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      return capitalise(d.toLocaleDateString(I18n.locale(), { month: 'long', year: 'numeric' }));
    }

    /** "Sep 4" / "4 sept" — short label for transaction rows. */
    function shortDate(iso) {
      if (!isDateKey(iso)) return iso || '';
      const p = iso.split('-');
      const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      return d.toLocaleDateString(I18n.locale(), { month: 'short', day: 'numeric' });
    }

    /** Percentage of `part` against `whole`, 0 when whole is 0. */
    function percent(part, whole) {
      if (!whole || whole <= 0) return part > 0 ? 100 : 0;
      return (part / whole) * 100;
    }

    function debounce(fn, wait) {
      let timer = null;
      return function () {
        const args = arguments, ctx = this;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(ctx, args), wait);
      };
    }

    return {
      $, $$, uid, esc, round2, parseAmount, clamp, capitalise, pad2, monthKey, dateKey,
      isMonthKey, isDateKey, shiftMonth, daysInMonth, monthStart, monthEnd,
      monthLabel, shortDate, percent, debounce
    };
  })();

  const { $, $$, esc, uid, round2, parseAmount } = Utils;

  /* ===========================================================
   * 3. STORE — the only layer that touches localStorage
   * =========================================================== */
  const Store = (() => {
    const KEY = 'householdFinance.v1';
    let available = true;
    let memoryFallback = null; // used when storage is blocked (private mode, etc.)

    function probe() {
      try {
        const probeKey = '__hf_probe__';
        window.localStorage.setItem(probeKey, '1');
        window.localStorage.removeItem(probeKey);
        available = true;
      } catch (err) {
        available = false;
      }
      return available;
    }

    function read() {
      if (!available) return memoryFallback;
      try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
      } catch (err) {
        console.error('[Store] Could not read saved data:', err);
        return null;
      }
    }

    function write(data) {
      if (!available) { memoryFallback = data; return { ok: true, fallback: true }; }
      try {
        window.localStorage.setItem(KEY, JSON.stringify(data));
        return { ok: true };
      } catch (err) {
        console.error('[Store] Could not save data:', err);
        memoryFallback = data;
        const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
        return { ok: false, error: t(quota ? 'err.storageFull' : 'err.storageWrite') };
      }
    }

    function clear() {
      memoryFallback = null;
      if (!available) return;
      try { window.localStorage.removeItem(KEY); }
      catch (err) { console.error('[Store] Could not clear data:', err); }
    }

    probe();

    return {
      read, write, clear,
      isAvailable() { return available; },
      storageKey: KEY
    };
  })();

  /* ===========================================================
   * 4. MODEL — shape, defaults, migration, CRUD
   * =========================================================== */
  const Model = (() => {
    const SCHEMA = 2;
    const DEFAULT_CURRENCY = 'GTQ';

    /* Seeds are translation KEYS: the name is resolved at seed time and
       then stored as plain user data, so renaming it later is safe. */
    const DEFAULT_CATEGORY_KEYS = [
      'seed.housing', 'seed.groceries', 'seed.transportation', 'seed.utilities',
      'seed.entertainment', 'seed.health', 'seed.personal', 'seed.misc'
    ];
    const DEFAULT_ALLOCATION_KEYS = ['seed.savings', 'seed.emergency', 'seed.debt', 'seed.investments'];

    const TX_TYPES = ['expense', 'income', 'allocation'];

    /** Map a transaction type to the month collection it references. */
    const REF_COLLECTION = { expense: 'categories', income: 'income', allocation: 'allocations' };

    let state = null;

    function emptyMonth() {
      return { income: [], categories: [], allocations: [], transactions: [] };
    }

    function blankState() {
      return {
        schema: SCHEMA,
        settings: { currency: DEFAULT_CURRENCY, theme: null, language: null },
        months: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    /** Defensive normaliser — also the migration entry point. */
    function normalise(raw) {
      const base = blankState();
      if (!raw || typeof raw !== 'object') return base;

      const fromSchema = Number(raw.schema) || 1;
      base.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt;

      if (raw.settings && typeof raw.settings === 'object') {
        if (typeof raw.settings.currency === 'string' && raw.settings.currency.length === 3) {
          base.settings.currency = raw.settings.currency.toUpperCase();
        }
        if (raw.settings.theme === 'light' || raw.settings.theme === 'dark') {
          base.settings.theme = raw.settings.theme;
        }
        if (I18n.available.indexOf(raw.settings.language) >= 0) {
          base.settings.language = raw.settings.language;
        }
      }

      /* Migration 1 → 2: the app moved to Guatemalan Quetzales, so data
         saved before the switch (which could only ever have been USD by
         default) adopts the new default. An explicit non-USD choice is kept. */
      if (fromSchema < 2 && base.settings.currency === 'USD') {
        base.settings.currency = DEFAULT_CURRENCY;
      }

      const months = (raw.months && typeof raw.months === 'object') ? raw.months : {};
      Object.keys(months).forEach((key) => {
        if (!Utils.isMonthKey(key)) return;
        const src = months[key] || {};
        const month = emptyMonth();

        month.income = toArray(src.income).map((item) => ({
          id: safeId(item.id, 'inc'),
          name: safeName(item.name, t('fallback.income')),
          planned: safeMoney(item.planned),
          actual: safeMoney(item.actual),
          note: safeNote(item.note)
        }));

        month.categories = toArray(src.categories).map((item) => ({
          id: safeId(item.id, 'cat'),
          name: safeName(item.name, t('fallback.category')),
          planned: safeMoney(item.planned),
          note: safeNote(item.note)
        }));

        month.allocations = toArray(src.allocations).map((item) => ({
          id: safeId(item.id, 'alc'),
          name: safeName(item.name, t('fallback.allocation')),
          planned: safeMoney(item.planned),
          actual: safeMoney(item.actual),
          note: safeNote(item.note)
        }));

        month.transactions = toArray(src.transactions).map((item) => ({
          id: safeId(item.id, 'tx'),
          date: Utils.isDateKey(item.date) ? item.date : Utils.monthStart(key),
          type: TX_TYPES.indexOf(item.type) >= 0 ? item.type : 'expense',
          refId: typeof item.refId === 'string' ? item.refId : null,
          description: safeName(item.description, t('fallback.transaction')),
          amount: safeMoney(item.amount),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
        }));

        base.months[key] = month;
      });

      return base;
    }

    function toArray(v) { return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []; }
    function safeId(v, p) { return (typeof v === 'string' && v) ? v : uid(p); }
    function safeName(v, fallback) {
      const s = String(v == null ? '' : v).trim().slice(0, 80);
      return s || fallback;
    }
    function safeNote(v) { return String(v == null ? '' : v).trim().slice(0, 240); }
    function safeMoney(v) {
      const n = parseAmount(v);
      if (!isFinite(n) || n < 0) return 0;
      return Math.min(n, 1e12);
    }

    /* ---------- lifecycle ---------- */

    function load() {
      state = normalise(Store.read());
      return state;
    }

    function persist() {
      state.updatedAt = new Date().toISOString();
      return Store.write(state);
    }

    function getState() { return state; }

    function replaceState(nextRaw) {
      state = normalise(nextRaw);
      return persist();
    }

    function mergeState(incomingRaw) {
      const incoming = normalise(incomingRaw);
      Object.keys(incoming.months).forEach((key) => { state.months[key] = incoming.months[key]; });
      state.settings = incoming.settings;
      return persist();
    }

    function resetAll() {
      state = blankState();
      Store.clear();
      return persist();
    }

    /* ---------- months ---------- */

    function hasMonth(key) { return Object.prototype.hasOwnProperty.call(state.months, key); }

    /** Returns the month, creating it on first access. The very first month is seeded. */
    function getMonth(key) {
      if (!hasMonth(key)) {
        const isFirstEver = Object.keys(state.months).length === 0;
        state.months[key] = emptyMonth();
        if (isFirstEver) seedDefaults(key);
        persist();
      }
      return state.months[key];
    }

    /** Read-only peek that never creates a month. */
    function peekMonth(key) { return hasMonth(key) ? state.months[key] : null; }

    function monthKeys() { return Object.keys(state.months).sort(); }

    function isMonthEmpty(key) {
      const m = peekMonth(key);
      if (!m) return true;
      return !m.income.length && !m.categories.length && !m.allocations.length && !m.transactions.length;
    }

    /** Seeds are named in whatever language is active right now. */
    function seedDefaults(key) {
      const month = state.months[key] || (state.months[key] = emptyMonth());

      const existing = month.categories.map((c) => c.name.toLowerCase());
      DEFAULT_CATEGORY_KEYS.forEach((transKey) => {
        const name = t(transKey);
        if (existing.indexOf(name.toLowerCase()) === -1) {
          month.categories.push({ id: uid('cat'), name: name, planned: 0, note: '' });
        }
      });

      const existingAlloc = month.allocations.map((a) => a.name.toLowerCase());
      DEFAULT_ALLOCATION_KEYS.forEach((transKey) => {
        const name = t(transKey);
        if (existingAlloc.indexOf(name.toLowerCase()) === -1) {
          month.allocations.push({ id: uid('alc'), name: name, planned: 0, actual: 0, note: '' });
        }
      });

      return persist();
    }

    /** Copy the *plan* (not the transactions) from one month into another. */
    function copyPlan(fromKey, toKey) {
      const from = peekMonth(fromKey);
      if (!from) return { ok: false, error: t('err.noDataIn', { month: Utils.monthLabel(fromKey) }) };

      const to = getMonth(toKey);
      to.income = from.income.map((i) => ({ id: uid('inc'), name: i.name, planned: i.planned, actual: 0, note: i.note }));
      to.categories = from.categories.map((c) => ({ id: uid('cat'), name: c.name, planned: c.planned, note: c.note }));
      to.allocations = from.allocations.map((a) => ({ id: uid('alc'), name: a.name, planned: a.planned, actual: 0, note: a.note }));
      const res = persist();
      return res.ok ? { ok: true } : res;
    }

    function clearMonth(key) {
      state.months[key] = emptyMonth();
      return persist();
    }

    /* ---------- generic entity CRUD ---------- */

    function collectionOf(monthKey, kind) {
      const month = getMonth(monthKey);
      if (kind === 'income') return month.income;
      if (kind === 'category') return month.categories;
      if (kind === 'allocation') return month.allocations;
      if (kind === 'transaction') return month.transactions;
      throw new Error('Unknown entity kind: ' + kind);
    }

    function findEntity(monthKey, kind, id) {
      const list = collectionOf(monthKey, kind);
      for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }

    function addEntity(monthKey, kind, data) {
      const list = collectionOf(monthKey, kind);
      const prefix = { income: 'inc', category: 'cat', allocation: 'alc', transaction: 'tx' }[kind];
      const record = Object.assign({ id: uid(prefix) }, data);
      if (kind === 'transaction') record.createdAt = new Date().toISOString();
      list.push(record);
      const res = persist();
      return res.ok ? { ok: true, record: record } : res;
    }

    function updateEntity(monthKey, kind, id, data) {
      const record = findEntity(monthKey, kind, id);
      if (!record) return { ok: false, error: t('err.itemGone') };
      Object.assign(record, data);
      const res = persist();
      return res.ok ? { ok: true, record: record } : res;
    }

    function removeEntity(monthKey, kind, id) {
      const list = collectionOf(monthKey, kind);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return { ok: false, error: t('err.itemGone') };
      list.splice(index, 1);

      // Orphaned transactions keep their history but lose the reference.
      if (kind !== 'transaction') {
        const month = getMonth(monthKey);
        month.transactions.forEach((tx) => { if (tx.refId === id) tx.refId = null; });
      }
      const res = persist();
      return res.ok ? { ok: true } : res;
    }

    /** How many transactions point at a given income/category/allocation. */
    function countLinkedTransactions(monthKey, id) {
      const month = getMonth(monthKey);
      return month.transactions.filter((tx) => tx.refId === id).length;
    }

    function setSetting(name, value) {
      state.settings[name] = value;
      return persist();
    }

    return {
      SCHEMA, DEFAULT_CURRENCY, TX_TYPES, REF_COLLECTION,
      load, persist, getState, replaceState, mergeState, resetAll, normalise,
      hasMonth, getMonth, peekMonth, monthKeys, isMonthEmpty, seedDefaults,
      copyPlan, clearMonth,
      findEntity, addEntity, updateEntity, removeEntity, countLinkedTransactions,
      setSetting
    };
  })();

  /* ===========================================================
   * 5. CALC — pure derived numbers, no DOM, no storage
   * =========================================================== */
  const Calc = (() => {
    const sum = (list, pick) => round2(list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0));

    /** Transactions of a type, optionally for one reference id. */
    function txOf(month, type, refId) {
      return month.transactions.filter((tx) =>
        tx.type === type && (refId === undefined || tx.refId === refId));
    }

    function incomeRows(month) {
      return month.income.map((src) => {
        const logged = sum(txOf(month, 'income', src.id), (tx) => tx.amount);
        const actual = round2(Number(src.actual || 0) + logged);
        return {
          id: src.id,
          name: src.name,
          note: src.note,
          planned: round2(src.planned || 0),
          recorded: round2(src.actual || 0),
          logged: logged,
          actual: actual,
          variance: round2(actual - (src.planned || 0)),
          pct: Utils.percent(actual, src.planned || 0)
        };
      });
    }

    function categoryRows(month) {
      const rows = month.categories.map((cat) => {
        const actual = sum(txOf(month, 'expense', cat.id), (tx) => tx.amount);
        const planned = round2(cat.planned || 0);
        return {
          id: cat.id,
          name: cat.name,
          note: cat.note,
          planned: planned,
          actual: actual,
          balance: round2(planned - actual),
          pct: Utils.percent(actual, planned),
          txCount: txOf(month, 'expense', cat.id).length,
          status: statusFor(planned, actual)
        };
      });

      // Expenses whose category was deleted still need to be visible.
      const orphan = month.transactions.filter((tx) =>
        tx.type === 'expense' && !month.categories.some((c) => c.id === tx.refId));
      if (orphan.length) {
        const actual = sum(orphan, (tx) => tx.amount);
        rows.push({
          id: null,
          name: t('cat.uncategorised'),
          note: '',
          planned: 0,
          actual: actual,
          balance: round2(-actual),
          pct: 100,
          txCount: orphan.length,
          status: 'over',
          isOrphan: true
        });
      }
      return rows;
    }

    function allocationRows(month) {
      return month.allocations.map((alloc) => {
        const logged = sum(txOf(month, 'allocation', alloc.id), (tx) => tx.amount);
        const actual = round2(Number(alloc.actual || 0) + logged);
        const planned = round2(alloc.planned || 0);
        return {
          id: alloc.id,
          name: alloc.name,
          note: alloc.note,
          planned: planned,
          recorded: round2(alloc.actual || 0),
          logged: logged,
          actual: actual,
          remaining: round2(planned - actual),
          pct: Utils.percent(actual, planned),
          status: planned > 0 && actual >= planned ? 'ok' : (actual > 0 ? 'partial' : 'none')
        };
      });
    }

    /** Traffic-light status for a spending category. */
    function statusFor(planned, actual) {
      if (planned <= 0) return actual > 0 ? 'over' : 'none';
      const pct = (actual / planned) * 100;
      if (pct > 100) return 'over';
      if (pct >= 85) return 'warn';
      return 'ok';
    }

    /** The headline figures for a month. */
    function summary(month) {
      const inc = incomeRows(month);
      const cats = categoryRows(month);
      const allocs = allocationRows(month);

      const incomePlanned = sum(inc, (r) => r.planned);
      const incomeActual = sum(inc, (r) => r.actual);

      const expensePlanned = sum(cats, (r) => r.planned);
      const expenseActual = sum(month.transactions.filter((tx) => tx.type === 'expense'), (tx) => tx.amount);

      const allocPlanned = sum(allocs, (r) => r.planned);
      const allocActual = sum(allocs, (r) => r.actual);

      return {
        income: { planned: incomePlanned, actual: incomeActual },
        expenses: { planned: expensePlanned, actual: expenseActual },
        allocations: { planned: allocPlanned, actual: allocActual },
        remaining: {
          planned: round2(incomePlanned - expensePlanned - allocPlanned),
          actual: round2(incomeActual - expenseActual - allocActual)
        },
        budgetLeft: round2(expensePlanned - expenseActual),
        counts: {
          income: month.income.length,
          categories: month.categories.length,
          allocations: month.allocations.length,
          transactions: month.transactions.length
        }
      };
    }

    /** Transactions sorted newest first, with their reference name resolved. */
    function transactionRows(month) {
      const nameFor = (tx) => {
        const list = month[Model.REF_COLLECTION[tx.type]] || [];
        const match = list.find((item) => item.id === tx.refId);
        return match ? match.name : null;
      };
      return month.transactions
        .slice()
        .sort((a, b) => {
          if (a.date === b.date) return String(b.createdAt).localeCompare(String(a.createdAt));
          return b.date.localeCompare(a.date);
        })
        .map((tx) => Object.assign({}, tx, { refName: nameFor(tx) }));
    }

    return { summary, incomeRows, categoryRows, allocationRows, transactionRows, statusFor, txOf };
  })();

  /* ===========================================================
   * 6. UI PRIMITIVES — money format, toast, modal, form builder
   * =========================================================== */

  /** Currency formatting, tied to both the currency and the active language. */
  const Money = (() => {
    let formatter = null;
    let currency = Model.DEFAULT_CURRENCY;

    function build(locale, code, display) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        currencyDisplay: display,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    /** Re-read the locale from I18n, so this runs again on every language change. */
    function configure(code) {
      currency = code || Model.DEFAULT_CURRENCY;
      const locale = I18n.locale();
      try {
        // narrowSymbol keeps GTQ as "Q1,250.00" instead of "GTQ 1,250.00" in English.
        formatter = build(locale, currency, 'narrowSymbol');
      } catch (err) {
        try { formatter = build(locale, currency, 'symbol'); }
        catch (err2) { formatter = null; }
      }
    }

    function format(value) {
      const n = Number(value) || 0;
      if (formatter) return formatter.format(n);
      return (n < 0 ? '-' : '') + currency + ' ' + Math.abs(n).toFixed(2);
    }

    /** Explicit sign — used for variances. */
    function signed(value) {
      const n = round2(Number(value) || 0);
      if (n === 0) return format(0);
      return (n > 0 ? '+' : '') + format(n);
    }

    function code() { return currency; }

    configure(Model.DEFAULT_CURRENCY);
    return { configure, format, signed, code };
  })();

  const Toast = (() => {
    const host = $('#toasts');

    function show(message, kind, ms) {
      const el = document.createElement('div');
      el.className = 'toast' + (kind ? ' toast--' + kind : '');
      el.textContent = message;
      host.appendChild(el);
      const life = ms || (kind === 'error' ? 5200 : 2800);
      setTimeout(() => {
        el.classList.add('is-leaving');
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, life);
    }

    return {
      info: (m) => show(m, null),
      ok: (m) => show(m, 'ok'),
      error: (m) => show(m, 'error', 5200)
    };
  })();

  const Modal = (() => {
    const root = $('#modal');
    const panel = $('#modalPanel');
    const titleEl = $('#modalTitle');
    const bodyEl = $('#modalBody');
    let lastFocused = null;
    let onCloseCb = null;

    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function open(title, contentNode, onClose) {
      lastFocused = document.activeElement;
      onCloseCb = onClose || null;
      titleEl.textContent = title;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(contentNode);
      root.hidden = false;
      document.body.style.overflow = 'hidden';

      const first = panel.querySelector('input:not([type=hidden]),select,textarea') ||
        panel.querySelector(FOCUSABLE);
      if (first) setTimeout(() => first.focus(), 30);
    }

    function close() {
      if (root.hidden) return;
      root.hidden = true;
      bodyEl.innerHTML = '';
      document.body.style.overflow = '';
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      const cb = onCloseCb;
      onCloseCb = null;
      if (cb) cb();
    }

    function isOpen() { return !root.hidden; }

    /* Close on backdrop / close button */
    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-close]');
      if (target) { e.preventDefault(); close(); }
    });

    /* Escape + focus trap */
    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;

      const items = $$(FOCUSABLE, panel).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    return { open, close, isOpen };
  })();

  /**
   * Generic, validated form inside the modal.
   * Own (translated) rules run first; the browser's native HTML5 constraint
   * message is only used as a last resort for anything they do not cover.
   */
  const Form = (() => {

    function buildField(field) {
      const wrap = document.createElement('div');
      wrap.className = 'field' + (field.className ? ' ' + field.className : '');
      wrap.dataset.field = field.name;
      if (field.full) wrap.style.gridColumn = '1 / -1';

      const id = 'f_' + field.name;
      const labelHtml = esc(field.label) + (field.required ? '<span class="req" aria-hidden="true">*</span>' : '');

      let control = '';
      const common = 'id="' + id + '" name="' + esc(field.name) + '"' +
        (field.required ? ' required' : '') +
        (field.autocomplete ? ' autocomplete="' + esc(field.autocomplete) + '"' : ' autocomplete="off"') +
        (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') +
        (field.hint ? ' aria-describedby="' + id + '_hint"' : '');

      if (field.type === 'select') {
        const opts = (field.options || []).map((o) =>
          '<option value="' + esc(o.value) + '"' + (String(o.value) === String(field.value) ? ' selected' : '') + '>' +
          esc(o.label) + '</option>').join('');
        control = '<select ' + common + '>' + opts + '</select>';
      } else if (field.type === 'textarea') {
        control = '<textarea ' + common + ' maxlength="' + (field.maxLength || 240) + '" rows="3">' +
          esc(field.value == null ? '' : field.value) + '</textarea>';
      } else if (field.type === 'money') {
        control = '<input type="number" ' + common +
          ' inputmode="decimal" step="0.01" min="' + (field.min != null ? field.min : 0) + '"' +
          (field.max != null ? ' max="' + field.max + '"' : '') +
          ' value="' + esc(field.value == null ? '' : field.value) + '">';
      } else if (field.type === 'date') {
        control = '<input type="date" ' + common +
          (field.min ? ' min="' + esc(field.min) + '"' : '') +
          (field.max ? ' max="' + esc(field.max) + '"' : '') +
          ' value="' + esc(field.value || '') + '">';
      } else {
        control = '<input type="' + esc(field.type || 'text') + '" ' + common +
          ' maxlength="' + (field.maxLength || 80) + '"' +
          ' value="' + esc(field.value == null ? '' : field.value) + '">';
      }

      wrap.innerHTML =
        '<label for="' + id + '">' + labelHtml + '</label>' +
        control +
        (field.hint ? '<p class="field__hint" id="' + id + '_hint">' + esc(field.hint) + '</p>' : '') +
        '<p class="field__error" role="alert"></p>';

      return wrap;
    }

    function open(config) {
      const form = document.createElement('form');
      form.className = 'form';
      form.noValidate = true; // we render our own translated messages

      const errorBox = document.createElement('div');
      errorBox.className = 'form__error';
      errorBox.setAttribute('role', 'alert');
      form.appendChild(errorBox);

      if (config.intro) {
        const intro = document.createElement('p');
        intro.className = 'card__sub';
        intro.textContent = config.intro;
        form.appendChild(intro);
      }

      const grid = document.createElement('div');
      grid.className = 'form__grid' + (config.columns === 2 ? ' form__grid--2' : '');
      config.fields.forEach((f) => grid.appendChild(buildField(f)));
      form.appendChild(grid);

      const actions = document.createElement('div');
      actions.className = 'form__actions';
      actions.innerHTML =
        '<button type="button" class="btn" data-close="true">' + esc(t('action.cancel')) + '</button>' +
        '<button type="submit" class="btn ' + (config.danger ? 'btn--danger' : 'btn--primary') + '">' +
        esc(config.submitLabel || t('action.save')) + '</button>';
      form.appendChild(actions);

      /* --- helpers exposed to onChange callbacks --- */
      const api = {
        form: form,
        get: (name) => form.elements[name],
        setOptions: function (name, options, selected) {
          const el = form.elements[name];
          if (!el) return;
          el.innerHTML = options.map((o) =>
            '<option value="' + esc(o.value) + '"' + (String(o.value) === String(selected) ? ' selected' : '') + '>' +
            esc(o.label) + '</option>').join('');
        },
        setLabel: function (name, text) {
          const label = form.querySelector('[data-field="' + name + '"] > label');
          if (label) label.textContent = text;
        },
        setHint: function (name, text) {
          const hint = form.querySelector('[data-field="' + name + '"] .field__hint');
          if (hint) hint.textContent = text;
        }
      };

      function clearErrors() {
        errorBox.classList.remove('is-visible');
        errorBox.textContent = '';
        $$('.field', form).forEach((f) => {
          f.classList.remove('has-error');
          const msg = f.querySelector('.field__error');
          if (msg) msg.textContent = '';
        });
      }

      function showFieldError(name, message) {
        const wrap = form.querySelector('[data-field="' + name + '"]');
        if (!wrap) return;
        wrap.classList.add('has-error');
        const msg = wrap.querySelector('.field__error');
        if (msg) msg.textContent = message;
        const control = form.elements[name];
        if (control) control.setAttribute('aria-invalid', 'true');
      }

      function readValues() {
        const values = {};
        config.fields.forEach((f) => {
          const el = form.elements[f.name];
          if (!el) return;
          values[f.name] = (f.type === 'money') ? parseAmount(el.value) : String(el.value).trim();
        });
        return values;
      }

      function validate(values) {
        const errors = [];
        config.fields.forEach((f) => {
          const el = form.elements[f.name];
          if (!el) return;
          el.removeAttribute('aria-invalid');
          const raw = String(el.value).trim();

          if (f.required && raw === '') {
            errors.push({ name: f.name, message: t('valid.required', { label: f.label }) });
            return;
          }
          if (raw === '' && !f.required) return;

          if (f.type === 'money') {
            const n = values[f.name];
            if (!isFinite(n)) {
              errors.push({ name: f.name, message: t('valid.invalidAmount') });
              return;
            }
            const min = f.min != null ? f.min : 0;
            if (n < min) {
              errors.push({ name: f.name, message: t('valid.minAmount', { label: f.label, amount: Money.format(min) }) });
              return;
            }
            if (f.max != null && n > f.max) {
              errors.push({ name: f.name, message: t('valid.maxAmount', { label: f.label, amount: Money.format(f.max) }) });
              return;
            }
          }

          if (f.type === 'date' && !Utils.isDateKey(raw)) {
            errors.push({ name: f.name, message: t('valid.invalidDate') });
            return;
          }

          if (typeof f.validate === 'function') {
            const custom = f.validate(values[f.name], values);
            if (custom) { errors.push({ name: f.name, message: custom }); return; }
          }

          /* Last resort: anything the browser rejects that we did not catch. */
          if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
            errors.push({ name: f.name, message: el.validationMessage || t('valid.checkField', { label: f.label }) });
          }
        });
        return errors;
      }

      form.addEventListener('input', (e) => {
        const wrap = e.target.closest('.field');
        if (wrap && wrap.classList.contains('has-error')) {
          wrap.classList.remove('has-error');
          const msg = wrap.querySelector('.field__error');
          if (msg) msg.textContent = '';
          e.target.removeAttribute('aria-invalid');
        }
      });

      if (typeof config.onChange === 'function') {
        form.addEventListener('change', (e) => {
          if (!e.target.name) return;
          config.onChange(e.target.name, readValues(), api);
        });
      }

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearErrors();
        const values = readValues();
        const errors = validate(values);

        if (errors.length) {
          errors.forEach((err) => showFieldError(err.name, err.message));
          errorBox.textContent = errors.length === 1
            ? errors[0].message
            : t('valid.summary', { n: errors.length });
          errorBox.classList.add('is-visible');
          const firstBad = form.elements[errors[0].name];
          if (firstBad && firstBad.focus) firstBad.focus();
          return;
        }

        const result = config.onSubmit(values);
        if (result && result.ok === false) {
          errorBox.textContent = result.error || t('valid.generic');
          errorBox.classList.add('is-visible');
          return;
        }
        Modal.close();
      });

      Modal.open(config.title, form);
      if (typeof config.onChange === 'function') {
        config.onChange('__init__', readValues(), api);
      }
    }

    return { open };
  })();

  /** Promise-based confirmation dialog. */
  function confirmDialog(options) {
    return new Promise((resolve) => {
      let settled = false;
      const wrap = document.createElement('div');
      wrap.innerHTML =
        '<p class="confirm__text">' + esc(options.message) + '</p>' +
        '<div class="form__actions">' +
        '<button type="button" class="btn" data-choice="no">' + esc(options.cancelLabel || t('action.cancel')) + '</button>' +
        '<button type="button" class="btn ' + (options.danger ? 'btn--danger' : 'btn--primary') + '" data-choice="yes">' +
        esc(options.confirmLabel || t('action.save')) + '</button>' +
        '</div>';

      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-choice]');
        if (!btn) return;
        settled = true;
        Modal.close();
        resolve(btn.dataset.choice === 'yes');
      });

      Modal.open(options.title, wrap, () => { if (!settled) resolve(false); });
      const confirmBtn = wrap.querySelector('[data-choice="yes"]');
      if (confirmBtn) setTimeout(() => confirmBtn.focus(), 30);
    });
  }

  /* ===========================================================
   * 7. RENDER — state ➜ DOM
   * =========================================================== */
  const Render = (() => {

    const TONE_CLASS = { ok: 'ok', warn: 'warn', over: 'over', none: 'none', info: 'info', partial: 'info' };

    function progressBar(pct, tone) {
      const width = Utils.clamp(isFinite(pct) ? pct : 0, 0, 100);
      const cls = TONE_CLASS[tone] || 'ok';
      return '<div class="progress progress--' + cls + '" role="progressbar" ' +
        'aria-valuenow="' + Math.round(isFinite(pct) ? pct : 0) + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="progress__bar" style="width:' + width.toFixed(1) + '%"></div></div>';
    }

    function emptyState(icon, title, text, actions) {
      return '<div class="empty">' +
        '<span class="empty__icon" aria-hidden="true">' + icon + '</span>' +
        '<p class="empty__title">' + esc(title) + '</p>' +
        '<p class="empty__text">' + esc(text) + '</p>' +
        (actions ? '<div class="empty__actions">' + actions + '</div>' : '') +
        '</div>';
    }

    function statusPill(status, pct) {
      const rounded = Math.round(isFinite(pct) ? pct : 0);
      if (status === 'over') return '<span class="pill pill--over">' + esc(t('status.over', { pct: rounded })) + '</span>';
      if (status === 'warn') return '<span class="pill pill--warn">' + esc(t('status.close', { pct: rounded })) + '</span>';
      if (status === 'none') return '<span class="pill">' + esc(t('status.noBudget')) + '</span>';
      return '<span class="pill pill--ok">' + esc(t('status.onTrack', { pct: rounded })) + '</span>';
    }

    function rowActions(kind, id) {
      return '<div class="row__actions">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-edit="' + kind + '" data-id="' + esc(id) + '">' +
        esc(t('action.edit')) + '</button>' +
        '<button type="button" class="icon-btn icon-btn--danger" data-delete="' + kind + '" data-id="' + esc(id) + '" ' +
        'aria-label="' + esc(t('action.delete')) + '"><span aria-hidden="true">🗑</span></button>' +
        '</div>';
    }

    /* ---------------- Dashboard ---------------- */

    function dashboard(month, monthKey) {
      const s = Calc.summary(month);
      const label = Utils.monthLabel(monthKey);

      /* Summary tiles */
      $('#summaryGrid').innerHTML = [
        tile('income', t('tile.income'), s.income.actual,
          t('tile.planned', { amount: Money.format(s.income.planned) }),
          t('tile.vsPlan', { amount: Money.signed(s.income.actual - s.income.planned) })),
        tile('expense', t('tile.spent'), s.expenses.actual,
          t('tile.budget', { amount: Money.format(s.expenses.planned) }),
          s.budgetLeft >= 0
            ? t('tile.left', { amount: Money.format(s.budgetLeft) })
            : t('tile.over', { amount: Money.format(Math.abs(s.budgetLeft)) })),
        tile('allocation', t('tile.allocated'), s.allocations.actual,
          t('tile.target', { amount: Money.format(s.allocations.planned) }),
          s.allocations.planned - s.allocations.actual > 0
            ? t('tile.toGo', { amount: Money.format(s.allocations.planned - s.allocations.actual) })
            : t('tile.fullyFunded')),
        tile('remaining', t('tile.unallocated'), s.remaining.actual,
          t('tile.planned', { amount: Money.format(s.remaining.planned) }),
          s.remaining.actual < 0 ? t('tile.overcommitted') : t('tile.available'),
          s.remaining.actual < 0 ? 'neg' : 'pos')
      ].join('');

      /* Planned vs actual */
      const nothingAtAll = s.income.planned + s.expenses.planned + s.allocations.planned === 0 &&
        s.income.actual + s.expenses.actual + s.allocations.actual === 0;

      $('#planActual').innerHTML = nothingAtAll
        ? emptyState('📊', t('empty.nothingPlanned.title'), t('empty.nothingPlanned.text', { month: label }),
          '<button type="button" class="btn btn--primary btn--sm" data-add="income">' +
          esc(t('empty.nothingPlanned.addIncome')) + '</button>' +
          '<button type="button" class="btn btn--sm" data-add="category">' +
          esc(t('empty.nothingPlanned.addCategory')) + '</button>')
        : '<div class="compare">' +
        compareRow(t('compare.income'), s.income.actual, s.income.planned, 'ok') +
        compareRow(t('compare.expenses'), s.expenses.actual, s.expenses.planned,
          Calc.statusFor(s.expenses.planned, s.expenses.actual)) +
        compareRow(t('compare.allocations'), s.allocations.actual, s.allocations.planned, 'info') +
        '</div>';

      /* Category health */
      const cats = Calc.categoryRows(month)
        .filter((c) => c.planned > 0 || c.actual > 0)
        .sort((a, b) => b.pct - a.pct || b.actual - a.actual);

      $('#categoryHealth').innerHTML = cats.length
        ? '<div class="compare">' + cats.map((c) =>
          '<div class="compare__row">' +
          '<div class="compare__top">' +
          '<span class="compare__name">' + esc(c.name) + ' ' + statusPill(c.status, c.pct) + '</span>' +
          '<span class="compare__nums num">' + Money.format(c.actual) + ' / ' + Money.format(c.planned) + '</span>' +
          '</div>' +
          progressBar(c.pct, c.status) +
          '<p class="row__sub ' + (c.balance < 0 ? 'neg' : 'muted') + '">' +
          esc(c.balance < 0
            ? t('cat.overBudget', { amount: Money.format(Math.abs(c.balance)) })
            : t('cat.remaining', { amount: Money.format(c.balance) })) +
          '</p>' +
          '</div>').join('') + '</div>'
        : emptyState('🎯', t('empty.noBudgets.title'), t('empty.noBudgets.text'),
          '<button type="button" class="btn btn--primary btn--sm" data-add="category">' +
          esc(t('empty.nothingPlanned.addCategory')) + '</button>');

      /* Allocation progress */
      const allocs = Calc.allocationRows(month).filter((a) => a.planned > 0 || a.actual > 0);
      $('#allocationProgress').innerHTML = allocs.length
        ? '<div class="compare">' + allocs.map((a) =>
          '<div class="compare__row">' +
          '<div class="compare__top">' +
          '<span class="compare__name">' + esc(a.name) + '</span>' +
          '<span class="compare__nums num">' + Money.format(a.actual) + ' / ' + Money.format(a.planned) + '</span>' +
          '</div>' +
          progressBar(a.pct, a.pct >= 100 ? 'ok' : 'info') +
          '</div>').join('') + '</div>'
        : emptyState('🏦', t('empty.noAllocs.title'), t('empty.noAllocs.text'),
          '<button type="button" class="btn btn--primary btn--sm" data-add="allocation">' +
          esc(t('empty.addAllocation')) + '</button>');

      /* Recent activity */
      const recent = Calc.transactionRows(month).slice(0, 5);
      $('#recentActivity').innerHTML = recent.length
        ? '<div class="rows">' + recent.map((tx) =>
          '<div class="row">' +
          '<div class="row__main">' +
          '<span class="row__title">' + esc(tx.description) + '</span>' +
          '<span class="row__sub">' + esc(Utils.shortDate(tx.date)) + ' · ' +
          esc(tx.refName || t('cat.uncategorised')) + '</span>' +
          '</div>' +
          '<div class="row__amounts">' +
          '<span class="row__amount num ' + (tx.type === 'income' ? 'pos' : '') + '">' +
          (tx.type === 'income' ? '+' : '−') + Money.format(tx.amount) + '</span>' +
          '</div>' +
          '</div>').join('') + '</div>'
        : emptyState('🧾', t('empty.noTx.title'), t('empty.noTx.dashText', { month: label }),
          '<button type="button" class="btn btn--primary btn--sm" data-add="transaction">' +
          esc(t('empty.addTransaction')) + '</button>');
    }

    function tile(kind, label, value, metaA, metaB, tone) {
      return '<article class="tile tile--' + kind + '">' +
        '<p class="tile__label">' + esc(label) + '</p>' +
        '<p class="tile__value num ' + (tone || '') + '">' + Money.format(value) + '</p>' +
        '<p class="tile__meta"><span>' + esc(metaA) + '</span><span>·</span><span>' + esc(metaB) + '</span></p>' +
        '</article>';
    }

    function compareRow(name, actual, planned, tone) {
      const pct = Utils.percent(actual, planned);
      return '<div class="compare__row">' +
        '<div class="compare__top">' +
        '<span class="compare__name">' + esc(name) + '</span>' +
        '<span class="compare__nums num">' +
        esc(t('compare.of', { actual: Money.format(actual), planned: Money.format(planned) })) +
        ' <strong>(' + Math.round(pct) + '%)</strong></span>' +
        '</div>' +
        progressBar(pct, tone) +
        '</div>';
    }

    /* ---------------- Income ---------------- */

    function income(month, monthKey) {
      const rows = Calc.incomeRows(month);

      $('#incomeList').innerHTML = rows.length
        ? '<div class="rows">' + rows.map((r) =>
          '<div class="row">' +
          '<div class="row__main">' +
          '<span class="row__title">' + esc(r.name) +
          (r.planned > 0
            ? '<span class="pill ' + (r.variance >= 0 ? 'pill--ok' : 'pill--warn') + '">' +
            esc(t('income.received', { pct: Math.round(r.pct) })) + '</span>'
            : '') +
          '</span>' +
          '<span class="row__sub">' +
          esc(t('income.plannedIs', { amount: Money.format(r.planned) })) +
          (r.logged > 0
            ? ' · ' + esc(t('income.breakdown', {
              recorded: Money.format(r.recorded), logged: Money.format(r.logged)
            }))
            : '') +
          (r.note ? ' · ' + esc(r.note) : '') +
          '</span>' +
          '</div>' +
          '<div class="row__amounts">' +
          '<span class="row__amount num">' + Money.format(r.actual) + '</span>' +
          '<span class="row__sub num ' + (r.variance < 0 ? 'neg' : 'pos') + '">' +
          esc(t('income.vsPlan', { amount: Money.signed(r.variance) })) + '</span>' +
          '</div>' +
          rowActions('income', r.id) +
          '</div>').join('') + '</div>'
        : emptyState('💵', t('empty.noIncome.title'),
          t('empty.noIncome.text', { month: Utils.monthLabel(monthKey) }),
          '<button type="button" class="btn btn--primary btn--sm" data-add="income">' +
          esc(t('empty.noIncome.btn')) + '</button>' + copyPlanButton(monthKey));

      const s = Calc.summary(month);
      $('#incomeFoot').innerHTML = rows.length ? totals([
        [t('income.footPlanned'), Money.format(s.income.planned)],
        [t('income.footReceived'), Money.format(s.income.actual)],
        [t('income.footDifference'), Money.signed(s.income.actual - s.income.planned)]
      ]) : '';
    }

    /* ---------------- Budget ---------------- */

    function budget(month, monthKey) {
      const rows = Calc.categoryRows(month);

      $('#categoryList').innerHTML = rows.length
        ? '<div class="rows">' + rows.map((c) =>
          '<div class="row">' +
          '<div class="row__main">' +
          '<span class="row__title">' + esc(c.name) + ' ' + statusPill(c.status, c.pct) + '</span>' +
          '<span class="row__sub">' + esc(t('cat.txCount', { n: c.txCount })) +
          (c.note ? ' · ' + esc(c.note) : '') + '</span>' +
          '</div>' +
          '<div class="row__amounts">' +
          '<span class="row__amount num">' + Money.format(c.actual) + '</span>' +
          '<span class="row__sub num">' +
          esc(t('common.of', { amount: Money.format(c.planned) })) + '</span>' +
          '</div>' +
          (c.isOrphan ? '' : rowActions('category', c.id)) +
          '<div class="row__progress">' + progressBar(c.pct, c.status) +
          '<p class="row__sub ' + (c.balance < 0 ? 'neg' : 'muted') + '" style="margin-top:4px">' +
          esc(c.balance < 0
            ? t('cat.overBudget', { amount: Money.format(Math.abs(c.balance)) })
            : t('cat.leftToSpend', { amount: Money.format(c.balance) })) + '</p>' +
          '</div>' +
          '</div>').join('') + '</div>'
        : emptyState('🗂️', t('empty.noCats.title'), t('empty.noCats.text'),
          '<button type="button" class="btn btn--primary btn--sm" data-add="category">' +
          esc(t('empty.noCats.btn')) + '</button>' +
          '<button type="button" class="btn btn--sm" data-menu-action="seed-defaults">' +
          esc(t('budget.useStarter')) + '</button>' + copyPlanButton(monthKey));

      const s = Calc.summary(month);
      $('#categoryFoot').innerHTML = rows.length ? totals([
        [t('budget.footBudgeted'), Money.format(s.expenses.planned)],
        [t('budget.footSpent'), Money.format(s.expenses.actual)],
        [s.budgetLeft >= 0 ? t('budget.footLeft') : t('budget.footOver'), Money.format(Math.abs(s.budgetLeft))]
      ]) : '';
    }

    /* ---------------- Allocations ---------------- */

    function allocations(month, monthKey) {
      const rows = Calc.allocationRows(month);

      $('#allocationList').innerHTML = rows.length
        ? '<div class="rows">' + rows.map((a) =>
          '<div class="row">' +
          '<div class="row__main">' +
          '<span class="row__title">' + esc(a.name) +
          (a.planned > 0 && a.actual >= a.planned
            ? '<span class="pill pill--ok">' + esc(t('alloc.funded')) + '</span>'
            : '<span class="pill pill--info">' + Math.round(a.pct) + '%</span>') +
          '</span>' +
          '<span class="row__sub">' +
          esc(a.remaining > 0
            ? t('alloc.stillToSet', { amount: Money.format(a.remaining) })
            : t('alloc.targetMet')) +
          (a.logged > 0 ? ' · ' + esc(t('alloc.includesLogged', { amount: Money.format(a.logged) })) : '') +
          (a.note ? ' · ' + esc(a.note) : '') +
          '</span>' +
          '</div>' +
          '<div class="row__amounts">' +
          '<span class="row__amount num">' + Money.format(a.actual) + '</span>' +
          '<span class="row__sub num">' +
          esc(t('common.of', { amount: Money.format(a.planned) })) + '</span>' +
          '</div>' +
          rowActions('allocation', a.id) +
          '<div class="row__progress">' + progressBar(a.pct, a.pct >= 100 ? 'ok' : 'info') + '</div>' +
          '</div>').join('') + '</div>'
        : emptyState('🏦', t('empty.noAllocs.title'), t('empty.noAllocsLong.text'),
          '<button type="button" class="btn btn--primary btn--sm" data-add="allocation">' +
          esc(t('empty.addAllocation')) + '</button>' +
          '<button type="button" class="btn btn--sm" data-menu-action="seed-defaults">' +
          esc(t('budget.useStarter')) + '</button>' + copyPlanButton(monthKey));

      const s = Calc.summary(month);
      $('#allocationFoot').innerHTML = rows.length ? totals([
        [t('alloc.footTarget'), Money.format(s.allocations.planned)],
        [t('alloc.footFunded'), Money.format(s.allocations.actual)],
        [t('alloc.footRemaining'), Money.format(Math.max(0, s.allocations.planned - s.allocations.actual))]
      ]) : '';
    }

    /* ---------------- Transactions ---------------- */

    function transactions(month, monthKey, filters) {
      const all = Calc.transactionRows(month);
      const label = Utils.monthLabel(monthKey);
      const q = (filters.search || '').trim().toLowerCase();

      const rows = all.filter((tx) => {
        if (filters.type !== 'all' && tx.type !== filters.type) return false;
        if (filters.ref !== 'all') {
          if (filters.ref === 'none' ? tx.refId : tx.refId !== filters.ref) return false;
        }
        if (q && (tx.description + ' ' + (tx.refName || '')).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });

      $('#txCount').textContent = all.length
        ? t('tx.count', { shown: rows.length, total: all.length, month: label })
        : t('tx.none', { month: label });

      const typePill = {
        expense: '<span class="pill pill--over">' + esc(t('tx.typeExpense')) + '</span>',
        income: '<span class="pill pill--ok">' + esc(t('tx.typeIncome')) + '</span>',
        allocation: '<span class="pill pill--info">' + esc(t('tx.typeAllocation')) + '</span>'
      };

      $('#transactionList').innerHTML = rows.length
        ? '<table class="tx-table"><caption class="sr-only">' + esc(t('tx.caption', { month: label })) + '</caption>' +
        '<thead><tr><th scope="col">' + esc(t('form.field.description')) + '</th>' +
        '<th scope="col">' + esc(t('form.field.amount')) + '</th>' +
        '<th scope="col">' + esc(t('form.field.type')) + '</th></tr></thead>' +
        '<tbody>' + rows.map((tx) =>
          '<tr>' +
          '<td class="tx-desc">' + esc(tx.description) + '</td>' +
          '<td class="tx-amount num ' + (tx.type === 'income' ? 'pos' : (tx.type === 'expense' ? 'neg' : '')) + '">' +
          (tx.type === 'income' ? '+' : '−') + Money.format(tx.amount) + '</td>' +
          '<td class="tx-meta">' + typePill[tx.type] +
          '<span>' + esc(Utils.shortDate(tx.date)) + '</span>' +
          '<span>' + esc(tx.refName || t('tx.unassigned')) + '</span></td>' +
          '<td class="tx-actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-edit="transaction" data-id="' + esc(tx.id) + '">' +
          esc(t('action.edit')) + '</button>' +
          '<button type="button" class="icon-btn icon-btn--danger" data-delete="transaction" data-id="' + esc(tx.id) + '" ' +
          'aria-label="' + esc(t('tx.deleteAria')) + '"><span aria-hidden="true">🗑</span></button>' +
          '</td>' +
          '</tr>').join('') + '</tbody></table>'
        : (all.length
          ? emptyState('🔍', t('empty.noMatches.title'), t('empty.noMatches.text'),
            '<button type="button" class="btn btn--sm" id="btnClearFilters2">' +
            esc(t('empty.noMatches.btn')) + '</button>')
          : emptyState('🧾', t('empty.noTx.title'), t('empty.noTx.text', { month: label }),
            '<button type="button" class="btn btn--primary btn--sm" data-add="transaction">' +
            esc(t('empty.addTransaction')) + '</button>'));

      const shown = rows.reduce((acc, tx) => {
        acc[tx.type] = round2((acc[tx.type] || 0) + tx.amount);
        return acc;
      }, {});
      $('#transactionFoot').innerHTML = rows.length ? totals([
        [t('tx.footExpenses'), Money.format(shown.expense || 0)],
        [t('tx.footIncome'), Money.format(shown.income || 0)],
        [t('tx.footAllocations'), Money.format(shown.allocation || 0)]
      ]) : '';
    }

    function totals(pairs) {
      return '<div class="totals">' + pairs.map((p) =>
        '<span class="totals__item"><span class="totals__label">' + esc(p[0]) + '</span>' +
        '<span class="totals__value num">' + esc(p[1]) + '</span></span>').join('') + '</div>';
    }

    function copyPlanButton(monthKey) {
      const prev = Utils.shiftMonth(monthKey, -1);
      if (Model.isMonthEmpty(prev)) return '';
      return '<button type="button" class="btn btn--sm" data-menu-action="copy-prev">' +
        esc(t('empty.copyPlanFrom', { month: Utils.monthLabel(prev) })) + '</button>';
    }

    return { dashboard, income, budget, allocations, transactions, progressBar, emptyState };
  })();

  /* ===========================================================
   * 8. APP — state wiring, events, bootstrap
   * =========================================================== */
  const App = (() => {
    let currentMonth = Utils.monthKey();
    let currentView = 'dashboard';
    const filters = { search: '', type: 'all', ref: 'all' };

    const CURRENCIES = ['GTQ', 'USD', 'MXN', 'EUR', 'BZD', 'HNL', 'CRC', 'NIO', 'SVC', 'PAB',
      'COP', 'CAD', 'GBP', 'CHF', 'JPY', 'BRL', 'ARS', 'CLP'];

    /* ---------------- theme ---------------- */

    function applyTheme(theme) {
      const resolved = theme || ((window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', resolved);
      $('#themeIcon').textContent = resolved === 'dark' ? '☀️' : '🌙';
      const label = t(resolved === 'dark' ? 'theme.toLight' : 'theme.toDark');
      $('#btnTheme').setAttribute('aria-label', label);
      $('#btnTheme').setAttribute('title', label);
    }

    function toggleTheme() {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      const res = Model.setSetting('theme', next);
      applyTheme(next);
      if (!res.ok) Toast.error(res.error);
    }

    /* ---------------- language ---------------- */

    /** Switch language, re-render everything, and persist the choice. */
    function applyLanguage(lang, options) {
      I18n.setLanguage(lang);
      Money.configure(Model.getState().settings.currency); // locale affects formatting
      I18n.applyStatic();

      const label = t('lang.switch');
      $('#langCode').textContent = I18n.other().toUpperCase();
      $('#btnLang').setAttribute('aria-label', label);
      $('#btnLang').setAttribute('title', label);

      applyTheme(document.documentElement.getAttribute('data-theme'));

      // applyStatic resets the tagline, so restore the warning if storage is blocked.
      if (!Store.isAvailable()) {
        $('#storageNote').textContent = t('app.storageBlocked');
        $('#storageNote').style.color = 'var(--c-danger)';
      }

      if (!options || options.render !== false) renderAll();
    }

    function toggleLanguage() {
      const next = I18n.other();
      const res = Model.setSetting('language', next);
      applyLanguage(next);
      if (!res.ok) Toast.error(res.error);
    }

    /* ---------------- navigation ---------------- */

    function setMonth(key) {
      if (!Utils.isMonthKey(key)) return;
      currentMonth = key;
      filters.ref = 'all';
      renderAll();
    }

    function setView(view) {
      currentView = view;
      $$('[role="tab"]').forEach((tab) => {
        const active = tab.dataset.view === view;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !active;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---------------- rendering ---------------- */

    function renderAll() {
      const month = Model.getMonth(currentMonth);
      const label = Utils.monthLabel(currentMonth);

      $('#monthLabel').textContent = label;
      $('#monthPicker').value = currentMonth;
      document.title = t('app.title') + ' — ' + label;
      $('#incomeSub').textContent = t('income.sub', { month: label });

      refreshRefFilter(month);

      Render.dashboard(month, currentMonth);
      Render.income(month, currentMonth);
      Render.budget(month, currentMonth);
      Render.allocations(month, currentMonth);
      Render.transactions(month, currentMonth, filters);
    }

    function refreshRefFilter(month) {
      const select = $('#txRef');
      const previous = filters.ref;
      select.innerHTML = ['<option value="all">' + esc(t('tx.allCategories')) + '</option>']
        .concat(month.categories.map((c) =>
          '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'))
        .concat(['<option value="none">' + esc(t('tx.unassigned')) + '</option>'])
        .join('');
      select.value = (previous === 'all' || previous === 'none' ||
        month.categories.some((c) => c.id === previous)) ? previous : 'all';
      filters.ref = select.value;
    }

    /* ---------------- entity forms ---------------- */

    function openIncomeForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'income', id) : null;
      Form.open({
        title: t(existing ? 'form.income.edit' : 'form.income.add'),
        columns: 2,
        submitLabel: t(existing ? 'action.saveChanges' : 'form.income.submitAdd'),
        fields: [
          {
            name: 'name', label: t('form.field.sourceName'), type: 'text', required: true, full: true,
            value: existing ? existing.name : '', placeholder: t('form.ph.sourceName'),
            hint: t('form.hint.sourceName')
          },
          {
            name: 'planned', label: t('form.field.plannedAmount'), type: 'money', required: true, min: 0,
            value: existing ? existing.planned : '', placeholder: '0.00',
            hint: t('form.hint.plannedAmount')
          },
          {
            name: 'actual', label: t('form.field.actualReceived'), type: 'money', required: true, min: 0,
            value: existing ? existing.actual : 0, placeholder: '0.00',
            hint: t('form.hint.actualReceived')
          },
          {
            name: 'note', label: t('form.field.note'), type: 'textarea', full: true,
            value: existing ? existing.note : ''
          }
        ],
        onSubmit: (v) => {
          const data = { name: v.name, planned: v.planned, actual: v.actual, note: v.note };
          const res = existing
            ? Model.updateEntity(currentMonth, 'income', id, data)
            : Model.addEntity(currentMonth, 'income', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(t(existing ? 'toast.incomeUpdated' : 'toast.incomeAdded'));
        }
      });
    }

    function openCategoryForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'category', id) : null;
      const spent = existing
        ? Calc.categoryRows(Model.getMonth(currentMonth)).find((c) => c.id === id)
        : null;

      Form.open({
        title: t(existing ? 'form.category.edit' : 'form.category.add'),
        columns: 2,
        submitLabel: t(existing ? 'action.saveChanges' : 'form.category.submitAdd'),
        intro: spent ? t('form.intro.spent', { amount: Money.format(spent.actual), n: spent.txCount }) : null,
        fields: [
          {
            name: 'name', label: t('form.field.categoryName'), type: 'text', required: true, full: true,
            value: existing ? existing.name : '', placeholder: t('form.ph.categoryName'),
            validate: (value) => {
              const clash = Model.getMonth(currentMonth).categories
                .some((c) => c.id !== id && c.name.toLowerCase() === String(value).toLowerCase());
              return clash ? t('form.err.duplicateCategory') : null;
            }
          },
          {
            name: 'planned', label: t('form.field.monthlyBudget'), type: 'money', required: true, min: 0,
            value: existing ? existing.planned : '', placeholder: '0.00',
            hint: t('form.hint.monthlyBudget')
          },
          {
            name: 'note', label: t('form.field.note'), type: 'textarea', full: true,
            value: existing ? existing.note : ''
          }
        ],
        onSubmit: (v) => {
          const data = { name: v.name, planned: v.planned, note: v.note };
          const res = existing
            ? Model.updateEntity(currentMonth, 'category', id, data)
            : Model.addEntity(currentMonth, 'category', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(t(existing ? 'toast.categoryUpdated' : 'toast.categoryAdded'));
        }
      });
    }

    function openAllocationForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'allocation', id) : null;
      Form.open({
        title: t(existing ? 'form.allocation.edit' : 'form.allocation.add'),
        columns: 2,
        submitLabel: t(existing ? 'action.saveChanges' : 'form.allocation.submitAdd'),
        fields: [
          {
            name: 'name', label: t('form.field.allocName'), type: 'text', required: true, full: true,
            value: existing ? existing.name : '', placeholder: t('form.ph.allocName')
          },
          {
            name: 'planned', label: t('form.field.targetMonth'), type: 'money', required: true, min: 0,
            value: existing ? existing.planned : '', placeholder: '0.00'
          },
          {
            name: 'actual', label: t('form.field.setAside'), type: 'money', required: true, min: 0,
            value: existing ? existing.actual : 0, placeholder: '0.00',
            hint: t('form.hint.setAside')
          },
          {
            name: 'note', label: t('form.field.note'), type: 'textarea', full: true,
            value: existing ? existing.note : ''
          }
        ],
        onSubmit: (v) => {
          const data = { name: v.name, planned: v.planned, actual: v.actual, note: v.note };
          const res = existing
            ? Model.updateEntity(currentMonth, 'allocation', id, data)
            : Model.addEntity(currentMonth, 'allocation', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(t(existing ? 'toast.allocationUpdated' : 'toast.allocationAdded'));
        }
      });
    }

    /** Options for the "assign to" select, which depends on the chosen type. */
    function refOptions(type) {
      const month = Model.getMonth(currentMonth);
      const items = month[Model.REF_COLLECTION[type] || 'categories'] || [];
      const head = t(type === 'expense' ? 'form.opt.uncategorised' : 'form.opt.unassigned');
      return [{ value: '', label: head }].concat(items.map((i) => ({ value: i.id, label: i.name })));
    }

    const REF_LABEL_KEY = {
      expense: 'form.field.refCategory',
      income: 'form.field.refIncome',
      allocation: 'form.field.refAllocation'
    };
    const REF_HINT_KEY = {
      expense: 'form.hint.refExpense',
      income: 'form.hint.refIncome',
      allocation: 'form.hint.refAllocation'
    };

    function openTransactionForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'transaction', id) : null;
      const label = Utils.monthLabel(currentMonth);

      const today = Utils.dateKey();
      const defaultDate = existing ? existing.date
        : (today.slice(0, 7) === currentMonth ? today : Utils.monthStart(currentMonth));
      const initialType = existing ? existing.type : 'expense';

      Form.open({
        title: t(existing ? 'form.tx.edit' : 'form.tx.add'),
        columns: 2,
        submitLabel: t(existing ? 'action.saveChanges' : 'form.tx.submitAdd'),
        fields: [
          {
            name: 'description', label: t('form.field.description'), type: 'text', required: true, full: true,
            value: existing ? existing.description : '', placeholder: t('form.ph.description')
          },
          {
            name: 'type', label: t('form.field.type'), type: 'select', required: true, value: initialType,
            options: [
              { value: 'expense', label: t('tx.typeExpense') },
              { value: 'income', label: t('tx.typeIncome') },
              { value: 'allocation', label: t('tx.typeAllocation') }
            ]
          },
          {
            name: 'amount', label: t('form.field.amount'), type: 'money', required: true, min: 0.01,
            value: existing ? existing.amount : '', placeholder: '0.00'
          },
          {
            name: 'refId', label: t(REF_LABEL_KEY[initialType]), type: 'select',
            value: existing ? (existing.refId || '') : '', options: refOptions(initialType),
            hint: t(REF_HINT_KEY[initialType])
          },
          {
            name: 'date', label: t('form.field.date'), type: 'date', required: true, value: defaultDate,
            min: Utils.monthStart(currentMonth), max: Utils.monthEnd(currentMonth),
            hint: t('form.hint.date', { month: label }),
            validate: (value) => (value >= Utils.monthStart(currentMonth) && value <= Utils.monthEnd(currentMonth))
              ? null
              : t('valid.dateRange', { month: label })
          }
        ],
        onChange: function (changedName, values, api) {
          if (changedName !== 'type' && changedName !== '__init__') return;
          const type = values.type || 'expense';
          api.setOptions('refId', refOptions(type), values.refId);
          api.setLabel('refId', t(REF_LABEL_KEY[type]));
          api.setHint('refId', t(REF_HINT_KEY[type]));
        },
        onSubmit: (v) => {
          const data = {
            description: v.description,
            type: v.type,
            amount: v.amount,
            refId: v.refId || null,
            date: v.date
          };
          const res = existing
            ? Model.updateEntity(currentMonth, 'transaction', id, data)
            : Model.addEntity(currentMonth, 'transaction', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(t(existing ? 'toast.txUpdated' : 'toast.txAdded'));
        }
      });
    }

    /* ---------------- delete flows ---------------- */

    async function handleDelete(kind, id) {
      const record = Model.findEntity(currentMonth, kind, id);
      if (!record) { Toast.error(t('err.itemGone')); renderAll(); return; }

      const kindLabel = t('kind.' + kind);
      const name = kind === 'transaction' ? record.description : record.name;
      let message = t('confirm.delete.msg', { name: name, month: Utils.monthLabel(currentMonth) });

      if (kind !== 'transaction') {
        const linked = Model.countLinkedTransactions(currentMonth, id);
        if (linked > 0) message += t('confirm.delete.linked', { n: linked });
      }

      const yes = await confirmDialog({
        title: t('confirm.delete.title', { kind: kindLabel }),
        message: message,
        confirmLabel: t('confirm.delete.btn'),
        danger: true
      });
      if (!yes) return;

      const res = Model.removeEntity(currentMonth, kind, id);
      if (!res.ok) { Toast.error(res.error); return; }
      renderAll();
      Toast.ok(Utils.capitalise(t('toast.deleted', { kind: kindLabel })));
    }

    /* ---------------- backup / restore ---------------- */

    function exportData() {
      try {
        const data = JSON.stringify(Model.getState(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'household-finance-backup-' + Utils.dateKey() + '.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        Toast.ok(t('toast.backupDownloaded'));
      } catch (err) {
        console.error(err);
        Toast.error(t('err.exportFailed'));
      }
    }

    function importData(file) {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { Toast.error(t('err.fileTooLarge')); return; }

      const reader = new FileReader();
      reader.onerror = () => Toast.error(t('err.fileRead'));
      reader.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(String(reader.result));
        } catch (err) {
          Toast.error(t('err.invalidJson'));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || !parsed.months || typeof parsed.months !== 'object') {
          Toast.error(t('err.notBackup'));
          return;
        }
        const monthCount = Object.keys(parsed.months).filter(Utils.isMonthKey).length;
        if (!monthCount) { Toast.error(t('err.noMonths')); return; }

        Form.open({
          title: t('import.title'),
          submitLabel: t('import.submit'),
          danger: true,
          intro: t('import.intro', { n: monthCount }),
          fields: [{
            name: 'mode', label: t('import.mode'), type: 'select', required: true, value: 'replace', full: true,
            options: [
              { value: 'replace', label: t('import.replace') },
              { value: 'merge', label: t('import.merge') }
            ]
          }],
          onSubmit: (v) => {
            const res = v.mode === 'merge' ? Model.mergeState(parsed) : Model.replaceState(parsed);
            if (!res.ok) return res;
            const settings = Model.getState().settings;
            applyTheme(settings.theme);
            const keys = Model.monthKeys();
            if (keys.indexOf(currentMonth) === -1 && keys.length) currentMonth = keys[keys.length - 1];
            applyLanguage(settings.language || I18n.language());
            Toast.ok(t('toast.backupRestored', { n: monthCount }));
          }
        });
      };
      reader.readAsText(file);
    }

    function openSettings() {
      const settings = Model.getState().settings;

      Form.open({
        title: t('settings.title'),
        columns: 2,
        submitLabel: t('settings.submit'),
        intro: t('settings.intro'),
        fields: [
          {
            name: 'currency', label: t('settings.currency'), type: 'select', required: true,
            value: settings.currency, hint: t('settings.currencyHint'),
            options: CURRENCIES.map((c) => ({ value: c, label: c }))
          },
          {
            name: 'language', label: t('settings.language'), type: 'select', required: true,
            value: I18n.language(), hint: t('settings.languageHint'),
            options: [
              { value: 'es', label: t('settings.langEs') },
              { value: 'en', label: t('settings.langEn') }
            ]
          }
        ],
        onSubmit: (v) => {
          const res1 = Model.setSetting('currency', v.currency);
          if (!res1.ok) return res1;
          const res2 = Model.setSetting('language', v.language);
          if (!res2.ok) return res2;
          applyLanguage(v.language);
          Toast.ok(t('toast.settingsSaved'));
        }
      });
    }

    /* ---------------- menu actions ---------------- */

    async function runMenuAction(action) {
      const menu = $('#dataMenu');
      if (menu) menu.open = false;

      if (action === 'export') { exportData(); return; }
      if (action === 'import') { $('#importFile').click(); return; }
      if (action === 'settings') { openSettings(); return; }

      if (action === 'seed-defaults') {
        const res = Model.seedDefaults(currentMonth);
        if (!res.ok) { Toast.error(res.error); return; }
        renderAll();
        Toast.ok(t('toast.starterAdded'));
        return;
      }

      if (action === 'copy-prev') {
        const prev = Utils.shiftMonth(currentMonth, -1);
        const prevLabel = Utils.monthLabel(prev);
        if (Model.isMonthEmpty(prev)) {
          Toast.error(t('err.nothingToCopy', { month: prevLabel }));
          return;
        }
        const yes = await confirmDialog({
          title: t('confirm.copy.title'),
          message: t('confirm.copy.msg', { from: prevLabel, to: Utils.monthLabel(currentMonth) }),
          confirmLabel: t('confirm.copy.btn')
        });
        if (!yes) return;
        const res = Model.copyPlan(prev, currentMonth);
        if (!res.ok) { Toast.error(res.error); return; }
        renderAll();
        Toast.ok(t('toast.planCopied', { month: prevLabel }));
        return;
      }

      if (action === 'clear-month') {
        const label = Utils.monthLabel(currentMonth);
        const yes = await confirmDialog({
          title: t('confirm.clear.title'),
          message: t('confirm.clear.msg', { month: label }),
          confirmLabel: t('confirm.clear.btn'), danger: true
        });
        if (!yes) return;
        const res = Model.clearMonth(currentMonth);
        if (!res.ok) { Toast.error(res.error); return; }
        renderAll();
        Toast.ok(t('toast.monthCleared', { month: label }));
        return;
      }

      if (action === 'reset-all') {
        const yes = await confirmDialog({
          title: t('confirm.reset.title'),
          message: t('confirm.reset.msg'),
          confirmLabel: t('confirm.reset.btn'), danger: true
        });
        if (!yes) return;
        Model.resetAll();
        currentMonth = Utils.monthKey();
        Model.setSetting('language', I18n.language());
        applyLanguage(I18n.language());
        Toast.ok(t('toast.allDeleted'));
      }
    }

    /* ---------------- events ---------------- */

    function bindEvents() {
      /* Month navigation */
      $('#btnPrevMonth').addEventListener('click', () => setMonth(Utils.shiftMonth(currentMonth, -1)));
      $('#btnNextMonth').addEventListener('click', () => setMonth(Utils.shiftMonth(currentMonth, 1)));
      $('#btnThisMonth').addEventListener('click', () => setMonth(Utils.monthKey()));
      $('#monthPicker').addEventListener('change', (e) => {
        if (Utils.isMonthKey(e.target.value)) setMonth(e.target.value);
        else e.target.value = currentMonth;
      });

      /* Tabs: click + roving keyboard focus */
      const tabs = $$('[role="tab"]');
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => setView(tab.dataset.view));
        tab.addEventListener('keydown', (e) => {
          const map = { ArrowRight: 1, ArrowLeft: -1 };
          let next = null;
          if (map[e.key] != null) next = (index + map[e.key] + tabs.length) % tabs.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = tabs.length - 1;
          if (next == null) return;
          e.preventDefault();
          tabs[next].focus();
          setView(tabs[next].dataset.view);
        });
      });

      /* Theme + language */
      $('#btnTheme').addEventListener('click', toggleTheme);
      $('#btnLang').addEventListener('click', toggleLanguage);

      /* Data menu */
      $('#dataMenu').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        runMenuAction(btn.dataset.action);
      });
      document.addEventListener('click', (e) => {
        const menu = $('#dataMenu');
        if (menu.open && !menu.contains(e.target)) menu.open = false;
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !Modal.isOpen()) $('#dataMenu').open = false;
      });

      /* Import file picker */
      $('#importFile').addEventListener('change', (e) => {
        importData(e.target.files && e.target.files[0]);
        e.target.value = '';
      });

      /* Delegated actions across every panel */
      document.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-add]');
        if (addBtn) {
          const kind = addBtn.dataset.add;
          if (kind === 'income') openIncomeForm();
          else if (kind === 'category') openCategoryForm();
          else if (kind === 'allocation') openAllocationForm();
          else if (kind === 'transaction') openTransactionForm();
          return;
        }

        const editBtn = e.target.closest('[data-edit]');
        if (editBtn) {
          const kind = editBtn.dataset.edit, id = editBtn.dataset.id;
          if (kind === 'income') openIncomeForm(id);
          else if (kind === 'category') openCategoryForm(id);
          else if (kind === 'allocation') openAllocationForm(id);
          else if (kind === 'transaction') openTransactionForm(id);
          return;
        }

        const delBtn = e.target.closest('[data-delete]');
        if (delBtn) { handleDelete(delBtn.dataset.delete, delBtn.dataset.id); return; }

        const gotoBtn = e.target.closest('[data-goto]');
        if (gotoBtn) { setView(gotoBtn.dataset.goto); return; }

        const menuAction = e.target.closest('[data-menu-action]');
        if (menuAction) { runMenuAction(menuAction.dataset.menuAction); return; }

        if (e.target.id === 'btnClearFilters2') resetFilters();
      });

      /* Transaction filters */
      const applySearch = Utils.debounce(() => {
        filters.search = $('#txSearch').value;
        Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
      }, 180);
      $('#txSearch').addEventListener('input', applySearch);
      $('#txType').addEventListener('change', (e) => {
        filters.type = e.target.value;
        Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
      });
      $('#txRef').addEventListener('change', (e) => {
        filters.ref = e.target.value;
        Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
      });
      $('#btnClearFilters').addEventListener('click', resetFilters);

      /* Keep multiple tabs of the app in sync */
      window.addEventListener('storage', (e) => {
        if (e.key !== Store.storageKey) return;
        Model.load();
        const settings = Model.getState().settings;
        applyTheme(settings.theme);
        applyLanguage(settings.language || I18n.language());
        Toast.info(t('toast.otherTab'));
      });
    }

    function resetFilters() {
      filters.search = '';
      filters.type = 'all';
      filters.ref = 'all';
      $('#txSearch').value = '';
      $('#txType').value = 'all';
      $('#txRef').value = 'all';
      Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
    }

    /* ---------------- bootstrap ---------------- */

    function init() {
      /* Language has to be resolved before the first Model.load(), because
         normalising can fall back to translated placeholder names. */
      const preload = Store.read();
      const savedLang = preload && preload.settings && preload.settings.language;
      I18n.setLanguage(I18n.available.indexOf(savedLang) >= 0 ? savedLang : I18n.detect());

      Model.load();
      const settings = Model.getState().settings;
      Money.configure(settings.currency);
      applyTheme(settings.theme);

      bindEvents();
      setView('dashboard');
      applyLanguage(I18n.language()); // paints static copy + renders every panel

      if (!Store.isAvailable()) {
        $('#storageNote').textContent = t('app.storageBlocked');
        $('#storageNote').style.color = 'var(--c-danger)';
        Toast.error(t('err.storageBlocked'));
      }
    }

    return { init };
  })();

  /* Boot once the DOM is parsed (the script uses `defer`, so this is immediate). */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})();
