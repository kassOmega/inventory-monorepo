// src/i18n/backend.en.ts
// English source-of-truth catalog for backend-emitted strings (exceptions,
// notification templates, audit actions, receipts, PDF/email headers).
// Keys are organized by domain; values may contain {{param}} placeholders.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const enMessages: Record<string, any> = {
  errors: {
    unauthorized: 'Unauthorized',
    forbidden: 'Forbidden resource',
    notFound: 'Not found',
    noActiveOrganization: 'No active organization',
    roleNotFound: 'Role not found',
    userNotFound: 'User not found',
    emailAlreadyExists: 'Email already exists',
    emailAlreadyRegistered: 'An account with this email already exists',
    invalidCredentials: 'Invalid email or password',
    currentPasswordIncorrect: 'Current password is incorrect',
    accountInactive: 'Account is inactive',
    passwordChanged: 'Password changed',
    loggedOut: 'Logged out',
    onlyOwnerCanChangePassword: 'Only the system owner can change passwords',
    onlyOwnerCanAssignSystemRoles: 'Only the system owner can assign system roles',
    staffInviteRoleRequired: 'A role must be selected when inviting a staff member',
    orgNotFound: 'Organization not found',
    orgLimitReached:
      'You have reached the limit of 2 businesses. Contact the admin to create more.',
    orgNameRequired: 'Organization name is required',
    slugInUse: 'Slug already in use',
    businessRequiredForCustomer:
      'A business must be selected to create a customer.',
    mustBeAssignedToShop: 'You must be assigned to a shop',
    onlyShopkeepersCreatePurchases: 'Only shopkeepers can create purchases',
    cashMethodRequired:
      'No "Cash" payment method found. Please add one first.',
    purchaseNotFound: 'Purchase not found',
    purchaseNotPending: 'Purchase is not pending',
    purchaseHasLinkedSale: 'Purchase already has a linked sale',
    stationKeyExists: 'A station with that key already exists.',
    stationNotFound: 'Station not found',
    userNotPartOfBusiness: 'This user is not part of the business.',
    stationAccessDenied: 'You do not have access to this station board.',
    menuCategoryNotFound: 'Menu category not found',
    menuItemNotFound: 'Menu item not found',
    orderNotFound: 'Order not found',
    paidOrderCannotBeEdited: 'Only orders that have not started at any station can be edited',
    paidOrdersCannotBeCancelled: 'Paid orders cannot be cancelled',
    paidOrdersCannotBeDeleted: 'Paid orders cannot be deleted',
    orderItemNotFound: 'Order item not found',
    stationItemUpdateDenied:
      'You do not have access to update items at this station.',
    cannotChangeItemToThatStatus: 'You cannot change this item to that status.',
    orderAlreadyClosed: 'This order is already closed.',
    noPermissionToServe: 'You do not have permission to serve orders.',
    noItemsReadyToServe: 'No items are ready to serve yet.',
    noOpenOrdersToSettle: 'No open orders found to settle',
    notificationNotFound: 'Notification not found',
    cannotReadThisNotification: 'You cannot read this notification',
    categoryNotFound: 'Category not found',
    categoryNameRequired: 'Category name is required',
    categoryNameExists: 'A category with this name already exists',
    productNotFound: 'Product not found',
    productVariantNotFound: 'Product variant not found',
    unitNotFound: 'Unit not found',
    locationNotFound: 'Location not found',
    locationNameRequired: 'Location name is required',
    locationTypeInvalid: 'Location type is invalid',
    customerNotFound: 'Customer not found',
    paymentMethodNotFound: 'Payment method not found',
    duplicatePaymentMethod: 'A payment method with that name already exists',
    requestNotFound: 'Request not found',
    requestItemNotFound: 'Request item not found',
    cannotModifyClosedRequest: 'Cannot modify a closed request',
    creditSaleNotFound: 'Credit sale not found',
    creditPaymentNotFound: 'Credit payment not found',
    saleNotFound: 'Sale not found',
    returnNotFound: 'Return not found',
    inventoryNotFound: 'Inventory record not found',
    quantityExceedsStock: 'Quantity exceeds available stock',
    financeAccountNotFound: 'Finance account not found',
    journalEntryNotFound: 'Journal entry not found',
    taxRateNotFound: 'Tax rate not found',
    fiscalConfigNotFound: 'Fiscal configuration not found',
    verificationPending: 'Your account is pending verification.',
    verificationRejected: 'Your verification was rejected.',
    businessVerificationRequired:
      'This business must be verified before it can operate.',
    reqNoLocation: 'You must be assigned to a location',
    reqSourceStoreRequired: 'Source store is required for store transfers',
    reqStockProblems: 'Insufficient stock at the {{label}}: {{problems}}',
    reqNotAvailableAt: '{{product}} is not available at the {{label}}',
    reqOnlyAvailableAt:
      '{{product}}: only {{available}} available at the {{label}} (requested {{requested}})',
    reqCannotEditClosed: 'Cannot edit a closed request',
    reqEditPermission: 'Only the owner or the request creator can edit this request',
    reqCannotEditDispatched: 'Cannot edit a request after dispatch has started',
    reqNeedsItem: 'A request needs at least one item',
    reqCannotSendBackClosed: 'Cannot send back a closed request',
    reqSendBackType: 'Send back only applies to shop-to-store and store-to-store requests',
    reqCannotSendBackDispatched: 'Cannot send back after dispatch has started',
    reqSendBackPermission:
      'Only the dispatching store or the owner can send a request back',
    reqCannotDeleteClosed: 'Cannot delete a closed request',
    reqDeletePermission: 'Only the owner or the request creator can delete this request',
    reqCannotDeleteDispatched: 'Cannot delete a request after dispatch has started',
    reqOwnerStoreStatuses:
      'Store requests can only be STORED, REJECTED or CANCELLED by owner',
    reqStoredQtyRequired: 'Quantity stored is required for {{product}}',
    reqStoreOverRequested:
      'Cannot store more than the requested amount ({{amount}}) for {{product}}',
    reqCannotRejectReceived:
      'Cannot reject {{product}} — it was already partially received',
    reqShopStatuses: 'Shop requests can only be APPROVED, REJECTED or CANCELLED by owner',
    reqDispatchType: 'Dispatch is only for shop-to-store and store-to-store requests',
    reqMustBeApproved: 'Request must be (partially) approved before dispatch',
    reqInvalidDispatchItem: 'Invalid item in dispatch data',
    reqDispatchOverRequested:
      'Cannot dispatch more than the requested amount ({{amount}}) for {{product}}',
    reqInsufficientStockProduct: 'Insufficient stock for {{product}}',
    requestAlreadyClosed: 'Request is already closed',
    reqConfirmReceiptReceiver: 'Only the receiving location user can confirm receipt',
    reqConfirmReceiptCreator: 'Only the request creator can confirm receipt',
    reqInvalidItemId: 'Invalid item ID: {{id}}',
    reqNothingPending: 'Nothing pending confirmation for {{product}}',
    reqReceivedQtyPositive: 'Received quantity must be greater than 0',
    reqConfirmOverDispatched:
      'Cannot confirm more than the dispatched amount ({{amount}}) for {{product}}',
    reqSaleOnReceiptType: 'Direct sale on receipt is only for shop-to-store requests',
    reqNoShopDestination: 'Request has no shop destination',
    reqNoItemsToSell: 'No items to sell',
    reqInvalidSaleItem: 'Invalid item in sale data',
    reqNothingPendingSale: '{{product}} has nothing pending confirmation',
    reqReceivedQtyGreaterZero: 'Received quantity must be greater than zero',
    reqReceiveOverDispatched:
      'Cannot receive more than the dispatched amount ({{amount}}) for {{product}}',
    reqSoldQtyRange:
      'Sold quantity must be between 0 and the received amount ({{amount}}) for {{product}}',
    resStationNoRole: 'This station has no role yet — save the station first.',
    resCannotChangeOwnerRole:
      'Cannot change the system owner account role here — use the Users page.',
    resStationIdNotFound: 'Station {{id}} not found',
    resEstCostRequired:
      'Estimated cost per portion is required and must be greater than zero for Benchmark tracking.',
    resMenuItemIdNotFound: 'Menu item {{id}} not found',
    resMakeItemReady: 'Make the item ready before handing it to the next station.',
    resNoNextStation:
      'This item has no next station — it will be marked served instead.',
    manufacturing: {
      bomNotFound: "Bill of materials not found",
      workOrderNotFound: "Work order not found",
      finishedProductNotFound: "Finished product not found",
      componentNotFound: "Raw material product not found",
      componentSameAsFinished: "A component cannot be the finished product itself",
      duplicateComponent: "The same component was listed more than once",
      itemsRequired: "A bill of materials needs at least one component line",
      bomHasWorkOrders: "Cannot delete a bill of materials that already has work orders",
      locationNotFound: "Production location not found",
      variantNotFound: "Finished product variant not found",
      productNotFound: "Product not found",
      invalidStatusTransition: "Cannot move a work order from {{from}} to {{to}}",
      insufficientStock: "Insufficient raw material stock: {{problems}}",
      producedQtyZero: "Produced quantity must be greater than zero after scrapped units",
      completionExceedsTarget:
        "Good units plus scrapped units exceed the work order target ({{target}})",
      workOrderNotInProgress: "Only in-progress work orders accept scrap entries",
      scrapProductNotInBom: "The scrapped product is not part of this work order",
      scrapExceedsTarget: "Scrap quantity exceeds the work order target ({{target}})",
      batchNumberInUse: "Batch number {{batchNumber}} is already used at another location",
      serviceNotFound: "Service not found",
      duplicateService: "A service with this name already exists",
      serviceHasIncomes: "Cannot delete a service that already has recorded income",
      incomeAccountMissing: "No income account found — add Production Revenue or Other Income first",
      jobNotFound: "Manufacturing job not found",
      invalidJobStage: "Cannot move a job from {{from}} to {{to}}",
      jobLocked:
        "This order has started production or is closed — cancel it instead of editing.",
      jobTitleRequired: "Order title is required",
      jobCannotDelete:
        "Orders in production or completed orders cannot be deleted — cancel them instead.",
      jobNeedsBom: "Jobs need a bill of materials and a target quantity before production",
      issueNotFound: "Material issue record not found",
      machineNotFound: "Machine not found",
      workerNotFound: "Worker not found",
      machineNotIssuable: "Only issuable machines can be checked out to a worker.",
      machineHasOpenIssuance: "Return the machine before removing it.",
      machineNotAvailable: "This machine is not available to be issued right now.",
      issueWorkerRequired: "Choose the worker the machine is issued to.",
      issuanceNotFound: "Machine issuance not found.",
      issuanceClosed: "This issuance has already been fully returned.",
      issuanceItemNotFound: "Issuance item not found.",
      patternNeedsDate: "A one-time shift pattern needs a date.",
      patternCantHaveDate: "A repeating shift pattern cannot have a date.",
      patternNeedsInstanceDate: "Pick the day this shift runs on.",
      patternWeekdayMismatch: "This pattern does not run on the day you picked.",
      machineComponentNotFound: "Machine component not found",
      shiftTemplateNotFound: "Shift template not found",
      shiftSessionNotFound: "Shift session not found",
      teamNotFound: "Manufacturing team not found",
      duplicateTeam: "A team with this name already exists",
      teamInUse:
        "This team is used by a flow or has orders in the pipeline — deactivate it instead of deleting",
      flowNotFound: "Production flow not found",
      duplicateFlow: "A flow with this name already exists",
      flowHasOrders: "Cannot delete a flow that orders are routed through",
      orderNotOnFlow: "This order is not on a production flow yet",
      orderOnFinalStep:
        "This order is on its final step — complete it instead.",
      vendorNotFound: "Vendor not found",
      duplicateVendor: "A vendor with this name already exists",
      vendorInUse: "Cannot delete a vendor that has purchase orders",
      poNotFound: "Purchase order not found",
      poItemsRequired: "A purchase order needs at least one line item",
      poNotEditable: "Only draft purchase orders can be edited",
      poCannotCancel: "Only draft or sent purchase orders without receipts can be cancelled",
      poHasReceipts: "Cannot delete a purchase order that has goods receipts",
      poNotReceivable: "Only sent or partially received purchase orders can receive stock",
      grnNotFound: "Goods receipt not found",
      grnLineNotOnPo: "A receiving line does not belong to this purchase order",
      grnOverReceipt: "Receiving more than the outstanding quantity for product #{{productId}} (remaining {{remaining}})",
      grnNothingReceived: "Enter a received or rejected quantity for at least one line",
    },

    // Interpolated throw sites (Phase 7): text the HTTP exception filter cannot
    // reverse-map, so each of these is raised through tr('errors.<key>', {...}).
    aiTrialEnded:
      '⚠️ The AI free trial ended on {{date}}. Contact the admin to extend or enable the AI feature.',
    aiDailyLimitReached:
      '⚠️ Daily limit reached: You have used {{quota}}/{{quota}} daily AI queries. Quota resets at midnight.',
    creditPaymentExceedsRemaining:
      'Payment of {{amount}} exceeds the remaining balance of {{remaining}} for that sale',
    customerDuplicate:
      'A customer matching "{{name}}" already exists. Please select the existing customer instead of creating a duplicate.',
    unknownPostingAction: "Unknown posting action '{{type}}'.",
    accountManagedByInventory:
      '"{{name}}" is managed automatically by inventory movements. Record inventory purchases via Restock / Procurement instead.',
    orderNotPaid: 'Order {{orderNumber}} is not paid',
    checkoutOpenFolios:
      'Cannot check out: {{count}} package guest(s) still have an open folio. Settle them first, or release the room with force.',
    checkoutOpenFoliosBalance:
      'Cannot check out: {{count}} package guest(s) still have an open folio and the room folio has a balance. Settle them first, or release the room with force.',
    roomBookingClash:
      'Room is already booked for those dates ({{guest}}) — pick another room or different dates.',
    guestIdTypeCodeExists: 'An ID type with the code "{{code}}" already exists.',
    overpaymentCollected:
      'Collected {{paid}} but only {{due}} is outstanding — adjust the payment split.',
    settleBalanceDue:
      'Collected {{paid}} of {{due}} due — collect the balance or check out with force.',
    insufficientStockAtLocation:
      'Insufficient stock: {{available}} unit(s) available at this location.',
    paymentExceedsBillOutstanding: 'Payment {{amount}} exceeds outstanding {{due}}',
    entitlementNeedsService: '{{kind}} entitlements must target a service.',
    packageAllowanceExceeded:
      '"{{name}}" exceeds the package allowance and price compensation is disabled — bill it separately or reduce the order.',
    paymentMethodNameExists: 'A payment method named "{{name}}" already exists',
    variantPricesRequired:
      'Variant {{index}}: buy and sell prices are required for variant products.',
    productDuplicate:
      'A product "{{brand}} {{name}}" already exists. Please edit the existing product instead of creating a duplicate.',
    itemAlreadyExists:
      '"{{name}}" already exists — select it from the item search instead of creating a duplicate.',
    variantNotFoundForProduct: 'Variant {{id}} not found for this product',
    missingPostingAccounts:
      '{{context}} could not be completed because the automatic ledger posting needs a chart-of-accounts entry that is missing: {{accounts}}. Add it in Finance -> Accounts, then retry.',
    insufficientStockForProduct: 'Insufficient stock for Product ID: {{id}}',
    insufficientBatchStock:
      'Insufficient batch stock for perishable product ({{short}} unit(s) short)',
    cannotSellQuantity:
      'Cannot sell {{quantity}}x "{{name}}". Only {{available}} available.',
    productNotInSale: 'Product {{id}} was not in this sale',
    returnExceedsSold: 'Cannot return {{quantity}} of product {{id}} (max {{max}})',
    serviceItemNotFound: 'Service item {{id}} not found',

    // Shared modules batch (Phase 7): auth / users / roles / taxes / cash /
    // guards / duplicate-detection and the small CRUD services.
    tooManyAttempts: 'Too many failed attempts. Try again later.',
    systemRoleNotEditable: 'System role cannot be edited',
    systemRoleNotDeletable: 'System role cannot be deleted',
    roleAssignedToUsers: 'Cannot delete a role that is assigned to users',
    onlyOwnerCanModifyOwner:
      'Only the system owner can modify the system owner account',
    cannotDemoteLastOwner: 'Cannot demote the last system owner',
    cannotChangeOwnStatus: 'You cannot change your own status',
    cannotDeactivateSystemRole: 'Cannot deactivate the system role',
    cannotDeleteOwnAccount: 'You cannot delete your own account',
    cannotDeleteLastOwner: 'Cannot delete the last system owner',
    defaultTaxRateUndeletable:
      'The default tax rate cannot be deleted. Set another rate as default first.',
    paymentNotFound: 'Payment not found',
    facilityPaymentNotFound: 'Facility payment not found',
    recordNotFound: 'Record not found',
    noProfileFields: 'No valid profile fields provided',
    ownerOnlyPushCounts: 'Only the owner can view push subscription counts',
    ownerOnlyPurgeSubscriptions: 'Only the owner can purge push subscriptions',
    csrfFailed: 'CSRF protection failed',
    notOrgMember: 'You are not a member of this organization',
    verticalNotAvailable: 'This feature is not available for your industry.',
    accountBlockedFraud:
      'Your account has been permanently blocked for repeated fraudulent verification attempts.',
    accountMustBeVerified:
      'Your account must be verified before you can use the system. Please complete the verification steps.',
    businessBlockedFraud:
      'This business has been permanently blocked for repeated fraudulent verification attempts.',
    businessNotVerified:
      'This business is not verified yet. Only verification actions are available until it is approved.',
    recordExists: 'This record already exists.',
    purchaseAlreadySubmitted:
      'This purchase was already submitted. Please refresh and try again.',
    saleAlreadySubmitted:
      'This sale was already submitted. Please refresh and try again.',
    orderAlreadySubmitted:
      'This order was already submitted. Please refresh and try again.',
    paymentAlreadySubmitted:
      'This payment was already submitted. Please refresh and try again.',
    duplicateService: 'A service with this name already exists.',


  },
};
