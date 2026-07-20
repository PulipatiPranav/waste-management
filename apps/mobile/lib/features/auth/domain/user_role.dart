/// The roles the API can return, mirrored from its `Role` enum. Kept as a typed enum
/// (not a raw string) so route guards switch on it exhaustively — a new role that no
/// screen handles is a compile warning, not a customer dropped on a blank screen.
enum UserRole {
  customer,
  apartmentAdmin,
  businessAdmin,
  deliveryPartner,
  recyclingPartnerAdmin,
  opsStaff,
  superAdmin,

  /// A role the app does not recognise (the API added one the app has not shipped for).
  /// Treated as a plain customer for navigation — never granted partner/admin screens.
  unknown;

  static UserRole fromApi(String value) {
    return switch (value) {
      'CUSTOMER' => UserRole.customer,
      'APARTMENT_ADMIN' => UserRole.apartmentAdmin,
      'BUSINESS_ADMIN' => UserRole.businessAdmin,
      'DELIVERY_PARTNER' => UserRole.deliveryPartner,
      'RECYCLING_PARTNER_ADMIN' => UserRole.recyclingPartnerAdmin,
      'OPS_STAFF' => UserRole.opsStaff,
      'SUPER_ADMIN' => UserRole.superAdmin,
      _ => UserRole.unknown,
    };
  }

  /// This build is the CUSTOMER + DELIVERY PARTNER app (one app, role-based navigation —
  /// see the Phase 11 note in the README). Ops/admin roles use the web console, not this
  /// app, so they get the customer shell here rather than a dead end.
  bool get isDeliveryPartner => this == UserRole.deliveryPartner;
}
