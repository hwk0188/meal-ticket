
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "families": {
                  Row: {
                    "created_at": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"issuances": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"family_id": string,"id": string,"issued_at": string,"issued_by": string,"meal_id": string,"memo": string | null,"person_id": string,"quantity": number,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"family_id": string,"id"?: string,"issued_at"?: string,"issued_by": string,"meal_id": string,"memo"?: string | null,"person_id": string,"quantity": number,"unit_price": number
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"family_id"?: string,"id"?: string,"issued_at"?: string,"issued_by"?: string,"meal_id"?: string,"memo"?: string | null,"person_id"?: string,"quantity"?: number,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "issuances_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issuances_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "families"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issuances_issued_by_fkey"
      columns: ["issued_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issuances_meal_id_fkey"
      columns: ["meal_id"]
isOneToOne: false
      referencedRelation: "meals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issuances_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"meals": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"note": string | null,"served_on": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"served_on": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"served_on"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meals_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"pairing_codes": {
                  Row: {
                    "auth_user_id": string,"code": string,"created_at": string,"expires_at": string,"kind": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id": string,"code": string,"created_at"?: string,"expires_at": string,"kind": string,"used_at"?: string | null
                  }
                  Update: {
                    "auth_user_id"?: string,"code"?: string,"created_at"?: string,"expires_at"?: string,"kind"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"people": {
                  Row: {
                    "auth_user_id": string | null,"consent_version": string | null,"consented_at": string | null,"created_at": string,"deleted_at": string | null,"family_id": string,"guardian_consented_at": string | null,"guardian_id": string | null,"id": string,"is_minor": boolean,"name": string,"phone": string | null,"role": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id"?: string | null,"consent_version"?: string | null,"consented_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"family_id": string,"guardian_consented_at"?: string | null,"guardian_id"?: string | null,"id"?: string,"is_minor"?: boolean,"name": string,"phone"?: string | null,"role"?: string,"updated_at"?: string
                  }
                  Update: {
                    "auth_user_id"?: string | null,"consent_version"?: string | null,"consented_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"family_id"?: string,"guardian_consented_at"?: string | null,"guardian_id"?: string | null,"id"?: string,"is_minor"?: boolean,"name"?: string,"phone"?: string | null,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "people_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "families"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "people_guardian_id_fkey"
      columns: ["guardian_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"usages": {
                  Row: {
                    "family_id": string,"id": string,"meal_id": string,"person_id": string,"quantity": number,"recorded_by": string,"request_id": string,"used_at": string,"used_via": string,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "family_id": string,"id"?: string,"meal_id": string,"person_id": string,"quantity"?: number,"recorded_by": string,"request_id": string,"used_at"?: string,"used_via": string,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "family_id"?: string,"id"?: string,"meal_id"?: string,"person_id"?: string,"quantity"?: number,"recorded_by"?: string,"request_id"?: string,"used_at"?: string,"used_via"?: string,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "usages_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "families"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usages_meal_id_fkey"
      columns: ["meal_id"]
isOneToOne: false
      referencedRelation: "meals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usages_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usages_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usages_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "ticket_balances": {
                  Row: {
                    "amount": number | null,"family_id": string | null,"issued": number | null,"meal_id": string | null,"remaining": number | null,"used": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "add_family_member":
{ Args: { "p_child_name"?: string,"p_code": string,"p_consent_version"?: string }; Returns: {
              "auth_user_id": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"deleted_at": string | null,
"family_id": string,
"guardian_consented_at": string | null,
"guardian_id": string | null,
"id": string,
"is_minor": boolean,
"name": string,
"phone": string | null,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "people"
        isOneToOne: true
        isSetofReturn: false
      } },
"admin_reset_person":
{ Args: { "p_person_id": string }; Returns: undefined
                           },
"cancel_issuance":
{ Args: { "p_issuance_id": string,"p_reason"?: string }; Returns: {
              "cancel_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"family_id": string,
"id": string,
"issued_at": string,
"issued_by": string,
"meal_id": string,
"memo": string | null,
"person_id": string,
"quantity": number,
"unit_price": number
            }
                          SetofOptions: {
        from: "*"
        to: "issuances"
        isOneToOne: true
        isSetofReturn: false
      } },
"claim_person":
{ Args: { "p_consent_version": string,"p_name": string,"p_phone": string }; Returns: {
              "auth_user_id": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"deleted_at": string | null,
"family_id": string,
"guardian_consented_at": string | null,
"guardian_id": string | null,
"id": string,
"is_minor": boolean,
"name": string,
"phone": string | null,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "people"
        isOneToOne: true
        isSetofReturn: false
      } },
"cleanup_empty_families":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"cleanup_orphan_anonymous_users":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"cleanup_pairing_codes":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"create_next_sunday_lunch":
{ Args: { "p_today"?: string }; Returns: {
              "created_at": string,
"created_by": string | null,
"id": string,
"note": string | null,
"served_on": string,
"title": string
            }
                          SetofOptions: {
        from: "*"
        to: "meals"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_pairing_code":
{ Args: { "p_kind": string }; Returns: {
              "code": string,"expires_at": string
            }[]
                           },
"current_family_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_person_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_valid_mobile":
{ Args: { "p": string }; Returns: boolean
                           },
"issue_tickets":
{ Args: { "p_meal_id": string,"p_memo"?: string,"p_person_id": string,"p_quantity": number,"p_unit_price": number }; Returns: {
              "cancel_reason": string | null,
"cancelled_at": string | null,
"cancelled_by": string | null,
"family_id": string,
"id": string,
"issued_at": string,
"issued_by": string,
"meal_id": string,
"memo": string | null,
"person_id": string,
"quantity": number,
"unit_price": number
            }
                          SetofOptions: {
        from: "*"
        to: "issuances"
        isOneToOne: true
        isSetofReturn: false
      } },
"leave_family":
{ Args: Record<PropertyKey, never>; Returns: {
              "auth_user_id": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"deleted_at": string | null,
"family_id": string,
"guardian_consented_at": string | null,
"guardian_id": string | null,
"id": string,
"is_minor": boolean,
"name": string,
"phone": string | null,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "people"
        isOneToOne: true
        isSetofReturn: false
      } },
"link_person":
{ Args: { "p_auth_user_id": string,"p_person_id": string }; Returns: {
              "auth_user_id": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"deleted_at": string | null,
"family_id": string,
"guardian_consented_at": string | null,
"guardian_id": string | null,
"id": string,
"is_minor": boolean,
"name": string,
"phone": string | null,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "people"
        isOneToOne: true
        isSetofReturn: false
      } },
"lock_family":
{ Args: { "p_family_id": string }; Returns: undefined
                           },
"lock_family_meal":
{ Args: { "p_family_id": string,"p_meal_id": string }; Returns: undefined
                           },
"merge_people":
{ Args: { "p_from_id": string,"p_into_id": string }; Returns: {
              "auth_user_id": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"deleted_at": string | null,
"family_id": string,
"guardian_consented_at": string | null,
"guardian_id": string | null,
"id": string,
"is_minor": boolean,
"name": string,
"phone": string | null,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "people"
        isOneToOne: true
        isSetofReturn: false
      } },
"normalize_name":
{ Args: { "p": string }; Returns: string
                           },
"normalize_phone":
{ Args: { "p": string }; Returns: string
                           },
"ping":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"relink_child":
{ Args: { "p_child_id": string,"p_code": string }; Returns: {
              "auth_user_id": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"deleted_at": string | null,
"family_id": string,
"guardian_consented_at": string | null,
"guardian_id": string | null,
"id": string,
"is_minor": boolean,
"name": string,
"phone": string | null,
"role": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "people"
        isOneToOne: true
        isSetofReturn: false
      } },
"remove_child":
{ Args: { "p_child_id": string }; Returns: undefined
                           },
"use_ticket":
{ Args: { "p_meal_id": string,"p_request_id": string }; Returns: {
              "family_id": string,
"id": string,
"meal_id": string,
"person_id": string,
"quantity": number,
"recorded_by": string,
"request_id": string,
"used_at": string,
"used_via": string,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "usages"
        isOneToOne: true
        isSetofReturn: false
      } },
"use_ticket_as_admin":
{ Args: { "p_family_id"?: string,"p_meal_id": string,"p_person_id": string,"p_request_id"?: string }; Returns: {
              "family_id": string,
"id": string,
"meal_id": string,
"person_id": string,
"quantity": number,
"recorded_by": string,
"request_id": string,
"used_at": string,
"used_via": string,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "usages"
        isOneToOne: true
        isSetofReturn: false
      } },
"void_usage":
{ Args: { "p_usage_id": string }; Returns: {
              "family_id": string,
"id": string,
"meal_id": string,
"person_id": string,
"quantity": number,
"recorded_by": string,
"request_id": string,
"used_at": string,
"used_via": string,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "usages"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
