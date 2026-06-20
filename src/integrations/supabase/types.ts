export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      anticipi: {
        Row: {
          assistito_id: string
          created_at: string
          data_anticipo: string
          farmacia_id: string
          farmaco: string
          id: string
          medico: string | null
          note: string | null
          quantita: number
          stato: string
          updated_at: string
        }
        Insert: {
          assistito_id: string
          created_at?: string
          data_anticipo?: string
          farmacia_id?: string
          farmaco: string
          id?: string
          medico?: string | null
          note?: string | null
          quantita?: number
          stato?: string
          updated_at?: string
        }
        Update: {
          assistito_id?: string
          created_at?: string
          data_anticipo?: string
          farmacia_id?: string
          farmaco?: string
          id?: string
          medico?: string | null
          note?: string | null
          quantita?: number
          stato?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anticipi_assistito_id_fkey"
            columns: ["assistito_id"]
            isOneToOne: false
            referencedRelation: "assistiti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anticipi_farmacia_fk"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      app_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      assistiti: {
        Row: {
          alias: string | null
          codice_fiscale: string | null
          cognome: string
          created_at: string
          esenzione: string | null
          farmacia_id: string
          id: string
          medico: string | null
          nome: string
          note: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          alias?: string | null
          codice_fiscale?: string | null
          cognome: string
          created_at?: string
          esenzione?: string | null
          farmacia_id?: string
          id?: string
          medico?: string | null
          nome: string
          note?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          alias?: string | null
          codice_fiscale?: string | null
          cognome?: string
          created_at?: string
          esenzione?: string | null
          farmacia_id?: string
          id?: string
          medico?: string | null
          nome?: string
          note?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistiti_farmacia_fk"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      debiti: {
        Row: {
          assistito_id: string
          created_at: string
          data_debito: string
          descrizione: string | null
          farmacia_id: string
          id: string
          importo: number
          stato: string
          updated_at: string
        }
        Insert: {
          assistito_id: string
          created_at?: string
          data_debito?: string
          descrizione?: string | null
          farmacia_id?: string
          id?: string
          importo: number
          stato?: string
          updated_at?: string
        }
        Update: {
          assistito_id?: string
          created_at?: string
          data_debito?: string
          descrizione?: string | null
          farmacia_id?: string
          id?: string
          importo?: number
          stato?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debiti_assistito_id_fkey"
            columns: ["assistito_id"]
            isOneToOne: false
            referencedRelation: "assistiti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debiti_farmacia_fk"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      famiglia_cf_pending: {
        Row: {
          codice_fiscale: string
          created_at: string
          farmacia_id: string
          id: string
          nucleo_id: string
        }
        Insert: {
          codice_fiscale: string
          created_at?: string
          farmacia_id: string
          id?: string
          nucleo_id: string
        }
        Update: {
          codice_fiscale?: string
          created_at?: string
          farmacia_id?: string
          id?: string
          nucleo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "famiglia_cf_pending_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "famiglia_cf_pending_nucleo_id_fkey"
            columns: ["nucleo_id"]
            isOneToOne: false
            referencedRelation: "famiglia_nuclei"
            referencedColumns: ["id"]
          },
        ]
      }
      famiglia_membri: {
        Row: {
          assistito_id: string
          created_at: string
          farmacia_id: string
          id: string
          nucleo_id: string
        }
        Insert: {
          assistito_id: string
          created_at?: string
          farmacia_id: string
          id?: string
          nucleo_id: string
        }
        Update: {
          assistito_id?: string
          created_at?: string
          farmacia_id?: string
          id?: string
          nucleo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "famiglia_membri_assistito_id_fkey"
            columns: ["assistito_id"]
            isOneToOne: true
            referencedRelation: "assistiti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "famiglia_membri_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "famiglia_membri_nucleo_id_fkey"
            columns: ["nucleo_id"]
            isOneToOne: false
            referencedRelation: "famiglia_nuclei"
            referencedColumns: ["id"]
          },
        ]
      }
      famiglia_nuclei: {
        Row: {
          color_index: number
          created_at: string
          farmacia_id: string
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          color_index?: number
          created_at?: string
          farmacia_id: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          color_index?: number
          created_at?: string
          farmacia_id?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "famiglia_nuclei_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      farmacia_citta_blocklist: {
        Row: {
          citta: string
          created_at: string
          farmacia_id: string
          id: string
          note: string | null
        }
        Insert: {
          citta: string
          created_at?: string
          farmacia_id: string
          id?: string
          note?: string | null
        }
        Update: {
          citta?: string
          created_at?: string
          farmacia_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "farmacia_citta_blocklist_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      farmacia_email_blocklist: {
        Row: {
          created_at: string
          email: string
          farmacia_id: string
          id: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          farmacia_id: string
          id?: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          farmacia_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "farmacia_email_blocklist_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      farmacia_gmail_tokens: {
        Row: {
          connected_at: string
          connected_by: string | null
          created_at: string
          farmacia_id: string
          gmail_email: string | null
          last_sync_at: string | null
          refresh_token: string
          scan_enabled: boolean
          updated_at: string
        }
        Insert: {
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          farmacia_id: string
          gmail_email?: string | null
          last_sync_at?: string | null
          refresh_token: string
          scan_enabled?: boolean
          updated_at?: string
        }
        Update: {
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          farmacia_id?: string
          gmail_email?: string | null
          last_sync_at?: string | null
          refresh_token?: string
          scan_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "farmacia_gmail_tokens_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: true
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      farmacia_members: {
        Row: {
          created_at: string
          farmacia_id: string
          id: string
          ruolo: Database["public"]["Enums"]["farmacia_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          farmacia_id: string
          id?: string
          ruolo?: Database["public"]["Enums"]["farmacia_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          farmacia_id?: string
          id?: string
          ruolo?: Database["public"]["Enums"]["farmacia_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "farmacia_members_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      farmacie: {
        Row: {
          attivata_at: string | null
          cap: string | null
          citta: string | null
          created_at: string
          data_stop_servizi: string
          email_contatto: string | null
          email_inoltro: string | null
          id: string
          indirizzo: string | null
          nome: string
          note_admin: string | null
          partita_iva: string | null
          ragione_sociale: string | null
          sospesa_at: string | null
          stato: Database["public"]["Enums"]["farmacia_stato"]
          telefono: string | null
          updated_at: string
        }
        Insert: {
          attivata_at?: string | null
          cap?: string | null
          citta?: string | null
          created_at?: string
          data_stop_servizi?: string
          email_contatto?: string | null
          email_inoltro?: string | null
          id?: string
          indirizzo?: string | null
          nome: string
          note_admin?: string | null
          partita_iva?: string | null
          ragione_sociale?: string | null
          sospesa_at?: string | null
          stato?: Database["public"]["Enums"]["farmacia_stato"]
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          attivata_at?: string | null
          cap?: string | null
          citta?: string | null
          created_at?: string
          data_stop_servizi?: string
          email_contatto?: string | null
          email_inoltro?: string | null
          id?: string
          indirizzo?: string | null
          nome?: string
          note_admin?: string | null
          partita_iva?: string | null
          ragione_sociale?: string | null
          sospesa_at?: string | null
          stato?: Database["public"]["Enums"]["farmacia_stato"]
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gmail_oauth_states: {
        Row: {
          created_at: string
          farmacia_id: string
          state: string
        }
        Insert: {
          created_at?: string
          farmacia_id: string
          state: string
        }
        Update: {
          created_at?: string
          farmacia_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_oauth_states_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: true
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      prenotazioni: {
        Row: {
          assistito_id: string
          created_at: string
          data_prenotazione: string
          farmacia_id: string
          farmaco: string
          id: string
          note: string | null
          quantita: number
          stato: string
          updated_at: string
        }
        Insert: {
          assistito_id: string
          created_at?: string
          data_prenotazione?: string
          farmacia_id?: string
          farmaco: string
          id?: string
          note?: string | null
          quantita?: number
          stato?: string
          updated_at?: string
        }
        Update: {
          assistito_id?: string
          created_at?: string
          data_prenotazione?: string
          farmacia_id?: string
          farmaco?: string
          id?: string
          note?: string | null
          quantita?: number
          stato?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prenotazioni_assistito_id_fkey"
            columns: ["assistito_id"]
            isOneToOne: false
            referencedRelation: "assistiti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prenotazioni_farmacia_fk"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ricette: {
        Row: {
          assistito_id: string | null
          citta: string | null
          codice_fiscale: string | null
          codice_regionale: string | null
          cognome: string | null
          created_at: string
          data_ricetta: string | null
          dpc: boolean
          esenzione: string | null
          farmacia_id: string
          id: string
          is_dpc_alert: boolean
          medico: string | null
          nome: string | null
          note: string | null
          numero_ricetta: string | null
          pdf_url: string | null
          raw_text: string | null
          source: string
          source_email_from: string | null
          source_email_id: string | null
          stato: string
          tipo_documento: string
          updated_at: string
        }
        Insert: {
          assistito_id?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          codice_regionale?: string | null
          cognome?: string | null
          created_at?: string
          data_ricetta?: string | null
          dpc?: boolean
          esenzione?: string | null
          farmacia_id?: string
          id?: string
          is_dpc_alert?: boolean
          medico?: string | null
          nome?: string | null
          note?: string | null
          numero_ricetta?: string | null
          pdf_url?: string | null
          raw_text?: string | null
          source?: string
          source_email_from?: string | null
          source_email_id?: string | null
          stato?: string
          tipo_documento?: string
          updated_at?: string
        }
        Update: {
          assistito_id?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          codice_regionale?: string | null
          cognome?: string | null
          created_at?: string
          data_ricetta?: string | null
          dpc?: boolean
          esenzione?: string | null
          farmacia_id?: string
          id?: string
          is_dpc_alert?: boolean
          medico?: string | null
          nome?: string | null
          note?: string | null
          numero_ricetta?: string | null
          pdf_url?: string | null
          raw_text?: string | null
          source?: string
          source_email_from?: string | null
          source_email_id?: string | null
          stato?: string
          tipo_documento?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ricette_assistito_id_fkey"
            columns: ["assistito_id"]
            isOneToOne: false
            referencedRelation: "assistiti"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ricette_farmacia_fk"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_alert_thresholds: {
        Row: {
          calls_per_hour_critical: number
          calls_per_hour_warning: number
          id: boolean
          spike_multiplier: number
          total_ms_per_day_critical: number
          total_ms_per_day_warning: number
          updated_at: string
        }
        Insert: {
          calls_per_hour_critical?: number
          calls_per_hour_warning?: number
          id?: boolean
          spike_multiplier?: number
          total_ms_per_day_critical?: number
          total_ms_per_day_warning?: number
          updated_at?: string
        }
        Update: {
          calls_per_hour_critical?: number
          calls_per_hour_warning?: number
          id?: boolean
          spike_multiplier?: number
          total_ms_per_day_critical?: number
          total_ms_per_day_warning?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_resource_logs: {
        Row: {
          created_at: string
          credits_cost: number | null
          execution_time_ms: number
          farmacia_id: string | null
          id: string
          metadata: Json | null
          resource_type: string
          timestamp: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          credits_cost?: number | null
          execution_time_ms?: number
          farmacia_id?: string | null
          id?: string
          metadata?: Json | null
          resource_type: string
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          credits_cost?: number | null
          execution_time_ms?: number
          farmacia_id?: string | null
          id?: string
          metadata?: Json | null
          resource_type?: string
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_resource_logs_farmacia_id_fkey"
            columns: ["farmacia_id"]
            isOneToOne: false
            referencedRelation: "farmacie"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_credits_per_farmacia: {
        Args: never
        Returns: {
          calls_24h: number
          calls_30d: number
          calls_7d: number
          credits_24h: number
          credits_30d: number
          credits_7d: number
          farmacia_id: string
          nome: string
        }[]
      }
      admin_resource_top_farmacie: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: {
          calls: number
          farmacia_id: string
          nome: string
          total_ms: number
        }[]
      }
      admin_resource_usage_series: {
        Args: {
          _bucket: string
          _farmacia_id?: string
          _from: string
          _to: string
        }
        Returns: {
          bucket: string
          calls: number
          resource_type: string
          total_ms: number
        }[]
      }
      admin_usage_alert_status: {
        Args: { _window_hours?: number }
        Returns: Json
      }
      current_farmacia_id: { Args: { _uid: string }; Returns: string }
      is_farmacia_attiva: { Args: { _farmacia_id: string }; Returns: boolean }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
    }
    Enums: {
      app_role: "super_admin"
      farmacia_role: "owner" | "staff"
      farmacia_stato: "attiva" | "sospesa" | "disattivata"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin"],
      farmacia_role: ["owner", "staff"],
      farmacia_stato: ["attiva", "sospesa", "disattivata"],
    },
  },
} as const
