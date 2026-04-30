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
      address_permit_history: {
        Row: {
          address: string | null
          address_norm: string
          city: string | null
          first_permit_date: string | null
          last_permit_date: string | null
          permit_count: number
          permits: Json
          state: string | null
          total_value: number | null
          trades: string[] | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          address_norm: string
          city?: string | null
          first_permit_date?: string | null
          last_permit_date?: string | null
          permit_count: number
          permits: Json
          state?: string | null
          total_value?: number | null
          trades?: string[] | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          address_norm?: string
          city?: string | null
          first_permit_date?: string | null
          last_permit_date?: string | null
          permit_count?: number
          permits?: Json
          state?: string | null
          total_value?: number | null
          trades?: string[] | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          amount: number | null
          created_at: string
          currency: string
          event_type: string
          id: string
          metadata: Json | null
          stripe_event_id: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string
          event_type: string
          id?: string
          metadata?: Json | null
          stripe_event_id: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          stripe_event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blast_campaigns: {
        Row: {
          channels: Json
          contractor_id: string
          created_at: string | null
          failed_count: number
          id: string
          job_type: string | null
          lead_id: string | null
          radius_miles: number | null
          sent_at: string | null
          sent_count: number
          status: string
          target_count: number | null
        }
        Insert: {
          channels?: Json
          contractor_id: string
          created_at?: string | null
          failed_count?: number
          id?: string
          job_type?: string | null
          lead_id?: string | null
          radius_miles?: number | null
          sent_at?: string | null
          sent_count?: number
          status?: string
          target_count?: number | null
        }
        Update: {
          channels?: Json
          contractor_id?: string
          created_at?: string | null
          failed_count?: number
          id?: string
          job_type?: string | null
          lead_id?: string | null
          radius_miles?: number | null
          sent_at?: string | null
          sent_count?: number
          status?: string
          target_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "blast_campaigns_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_campaigns_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_campaigns_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      blast_events: {
        Row: {
          campaign_id: string
          delivered: boolean
          error: string | null
          id: string
          lead_id: string
          provider_message_id: string | null
          sent_at: string
        }
        Insert: {
          campaign_id: string
          delivered?: boolean
          error?: string | null
          id?: string
          lead_id: string
          provider_message_id?: string | null
          sent_at?: string
        }
        Update: {
          campaign_id?: string
          delivered?: boolean
          error?: string | null
          id?: string
          lead_id?: string
          provider_message_id?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blast_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "blast_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_interviews: {
        Row: {
          author_id: string
          contractor_company: string | null
          contractor_name: string
          created_at: string
          crew_size: number | null
          id: string
          interviewed_at: string
          last_3_leads: Json | null
          notes: string | null
          ranked_complaints: Json | null
          state: string | null
          trade: string | null
          updated_at: string
          years_in_business: number | null
        }
        Insert: {
          author_id: string
          contractor_company?: string | null
          contractor_name: string
          created_at?: string
          crew_size?: number | null
          id?: string
          interviewed_at?: string
          last_3_leads?: Json | null
          notes?: string | null
          ranked_complaints?: Json | null
          state?: string | null
          trade?: string | null
          updated_at?: string
          years_in_business?: number | null
        }
        Update: {
          author_id?: string
          contractor_company?: string | null
          contractor_name?: string
          created_at?: string
          crew_size?: number | null
          id?: string
          interviewed_at?: string
          last_3_leads?: Json | null
          notes?: string | null
          ranked_complaints?: Json | null
          state?: string | null
          trade?: string | null
          updated_at?: string
          years_in_business?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contractor_interviews_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_interviews_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_licenses: {
        Row: {
          contractor_id: string
          created_at: string
          expiry_date: string | null
          holder_name: string | null
          id: string
          last_checked_at: string | null
          license_class: string | null
          license_number: string
          license_state: string
          license_type: string | null
          raw_response: Json | null
          updated_at: string
          verification_status: string
          verified: boolean
        }
        Insert: {
          contractor_id: string
          created_at?: string
          expiry_date?: string | null
          holder_name?: string | null
          id?: string
          last_checked_at?: string | null
          license_class?: string | null
          license_number: string
          license_state: string
          license_type?: string | null
          raw_response?: Json | null
          updated_at?: string
          verification_status?: string
          verified?: boolean
        }
        Update: {
          contractor_id?: string
          created_at?: string
          expiry_date?: string | null
          holder_name?: string | null
          id?: string
          last_checked_at?: string | null
          license_class?: string | null
          license_number?: string
          license_state?: string
          license_type?: string | null
          raw_response?: Json | null
          updated_at?: string
          verification_status?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contractor_licenses_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_licenses_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_benchmarks: {
        Row: {
          cost_avg: number
          cost_high: number
          cost_low: number
          id: string
          last_updated: string
          project_type: string
          sample_size: number
          trade: string
          unit: string
          zip_prefix: string
        }
        Insert: {
          cost_avg: number
          cost_high: number
          cost_low: number
          id?: string
          last_updated?: string
          project_type: string
          sample_size?: number
          trade: string
          unit?: string
          zip_prefix: string
        }
        Update: {
          cost_avg?: number
          cost_high?: number
          cost_low?: number
          id?: string
          last_updated?: string
          project_type?: string
          sample_size?: number
          trade?: string
          unit?: string
          zip_prefix?: string
        }
        Relationships: []
      }
      engagement_scores: {
        Row: {
          avg_response_h: number | null
          churn_risk: string
          close_rate: number | null
          computed_at: string
          contacted_30d: number
          contractor_id: string
          conversion_score: number
          last_lead_action: string | null
          last_login: string | null
          lead_action_score: number
          leads_30d: number
          login_score: number
          outreach_score: number
          revenue_30d: number
          tier: string
          total_score: number
          won_30d: number
        }
        Insert: {
          avg_response_h?: number | null
          churn_risk?: string
          close_rate?: number | null
          computed_at?: string
          contacted_30d?: number
          contractor_id: string
          conversion_score?: number
          last_lead_action?: string | null
          last_login?: string | null
          lead_action_score?: number
          leads_30d?: number
          login_score?: number
          outreach_score?: number
          revenue_30d?: number
          tier?: string
          total_score?: number
          won_30d?: number
        }
        Update: {
          avg_response_h?: number | null
          churn_risk?: string
          close_rate?: number | null
          computed_at?: string
          contacted_30d?: number
          contractor_id?: string
          conversion_score?: number
          last_lead_action?: string | null
          last_login?: string | null
          lead_action_score?: number
          leads_30d?: number
          login_score?: number
          outreach_score?: number
          revenue_30d?: number
          tier?: string
          total_score?: number
          won_30d?: number
        }
        Relationships: [
          {
            foreignKeyName: "engagement_scores_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: true
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_scores_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          contractor_id: string
          created_at: string
          delivered_at: string | null
          delivered_pdf_url: string | null
          delivered_to_email: string | null
          id: string
          lead_id: string | null
          line_items: Json
          notes: string | null
          sent_at: string | null
          status: string
          subtotal: number | null
          tax_rate: number | null
          title: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          delivered_at?: string | null
          delivered_pdf_url?: string | null
          delivered_to_email?: string | null
          id?: string
          lead_id?: string | null
          line_items?: Json
          notes?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number | null
          tax_rate?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          delivered_at?: string | null
          delivered_pdf_url?: string | null
          delivered_to_email?: string | null
          id?: string
          lead_id?: string | null
          line_items?: Json
          notes?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number | null
          tax_rate?: number | null
          title?: string | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_requests: {
        Row: {
          amount: number
          apr: number
          contractor_id: string
          created_at: string
          id: string
          lead_id: string | null
          partner: string | null
          status: string
          term_months: number
        }
        Insert: {
          amount: number
          apr: number
          contractor_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          partner?: string | null
          status?: string
          term_months: number
        }
        Update: {
          amount?: number
          apr?: number
          contractor_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          partner?: string | null
          status?: string
          term_months?: number
        }
        Relationships: []
      }
      follow_up_sequences: {
        Row: {
          active: boolean
          contractor_id: string
          created_at: string
          current_step: number
          id: string
          lead_id: string | null
          name: string
          sequence_template_id: string | null
          started_at: string
          status: string
          steps: Json
          trigger_status: string
          variables: Json
        }
        Insert: {
          active?: boolean
          contractor_id: string
          created_at?: string
          current_step?: number
          id?: string
          lead_id?: string | null
          name: string
          sequence_template_id?: string | null
          started_at?: string
          status?: string
          steps?: Json
          trigger_status: string
          variables?: Json
        }
        Update: {
          active?: boolean
          contractor_id?: string
          created_at?: string
          current_step?: number
          id?: string
          lead_id?: string | null
          name?: string
          sequence_template_id?: string | null
          started_at?: string
          status?: string
          steps?: Json
          trigger_status?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequences_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequences_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequences_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      homeowner_intakes: {
        Row: {
          budget_range: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          henri_score: number | null
          id: string
          matched_contractor_id: string | null
          matched_lead_id: string | null
          photos: string[] | null
          refinement_answers: Json | null
          status: string
          timeline: string | null
          trade: string
          updated_at: string
          zip: string
        }
        Insert: {
          budget_range?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          henri_score?: number | null
          id?: string
          matched_contractor_id?: string | null
          matched_lead_id?: string | null
          photos?: string[] | null
          refinement_answers?: Json | null
          status?: string
          timeline?: string | null
          trade: string
          updated_at?: string
          zip: string
        }
        Update: {
          budget_range?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          henri_score?: number | null
          id?: string
          matched_contractor_id?: string | null
          matched_lead_id?: string | null
          photos?: string[] | null
          refinement_answers?: Json | null
          status?: string
          timeline?: string | null
          trade?: string
          updated_at?: string
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "homeowner_intakes_matched_contractor_id_fkey"
            columns: ["matched_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeowner_intakes_matched_contractor_id_fkey"
            columns: ["matched_contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homeowner_intakes_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      homeowner_maintenance_completed: {
        Row: {
          completed_at: string
          owner_id: string
          task_id: string
        }
        Insert: {
          completed_at?: string
          owner_id: string
          task_id: string
        }
        Update: {
          completed_at?: string
          owner_id?: string
          task_id?: string
        }
        Relationships: []
      }
      homeowner_properties: {
        Row: {
          created_at: string
          home_sqft: number | null
          home_value: number | null
          lot_sqft: number | null
          mortgage: number | null
          owner_id: string
          updated_at: string
          year_built: number | null
          zip: string | null
        }
        Insert: {
          created_at?: string
          home_sqft?: number | null
          home_value?: number | null
          lot_sqft?: number | null
          mortgage?: number | null
          owner_id: string
          updated_at?: string
          year_built?: number | null
          zip?: string | null
        }
        Update: {
          created_at?: string
          home_sqft?: number | null
          home_value?: number | null
          lot_sqft?: number | null
          mortgage?: number | null
          owner_id?: string
          updated_at?: string
          year_built?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      intake_matches: {
        Row: {
          contractor_id: string
          created_at: string
          factors: Json | null
          id: string
          intake_id: string
          is_primary: boolean
          notified_at: string | null
          rank: number
          score: number
          status: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          factors?: Json | null
          id?: string
          intake_id: string
          is_primary?: boolean
          notified_at?: string | null
          rank?: number
          score?: number
          status?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          factors?: Json | null
          id?: string
          intake_id?: string
          is_primary?: boolean
          notified_at?: string | null
          rank?: number
          score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_matches_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_matches_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_matches_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "homeowner_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_milestones: {
        Row: {
          completed_date: string | null
          contractor_id: string
          created_at: string
          description: string | null
          id: string
          lead_id: string
          notes: string | null
          payment_amount: number | null
          payment_status: string | null
          photos: string[] | null
          scheduled_date: string | null
          sort_order: number
          status: Database["public"]["Enums"]["milestone_status"]
          title: string
        }
        Insert: {
          completed_date?: string | null
          contractor_id: string
          created_at?: string
          description?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          payment_amount?: number | null
          payment_status?: string | null
          photos?: string[] | null
          scheduled_date?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["milestone_status"]
          title: string
        }
        Update: {
          completed_date?: string | null
          contractor_id?: string
          created_at?: string
          description?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          payment_amount?: number | null
          payment_status?: string | null
          photos?: string[] | null
          scheduled_date?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["milestone_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_milestones_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_milestones_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_milestones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_exclusivity_locks: {
        Row: {
          contractor_id: string
          created_at: string
          forfeit_deadline: string | null
          id: string
          lead_id: string
          released_at: string | null
          released_reason:
            | Database["public"]["Enums"]["exclusivity_release_reason"]
            | null
          trade: string | null
          updated_at: string
          window_end: string
          window_start: string
          zip: string | null
        }
        Insert: {
          contractor_id: string
          created_at?: string
          forfeit_deadline?: string | null
          id?: string
          lead_id: string
          released_at?: string | null
          released_reason?:
            | Database["public"]["Enums"]["exclusivity_release_reason"]
            | null
          trade?: string | null
          updated_at?: string
          window_end: string
          window_start?: string
          zip?: string | null
        }
        Update: {
          contractor_id?: string
          created_at?: string
          forfeit_deadline?: string | null
          id?: string
          lead_id?: string
          released_at?: string | null
          released_reason?:
            | Database["public"]["Enums"]["exclusivity_release_reason"]
            | null
          trade?: string | null
          updated_at?: string
          window_end?: string
          window_start?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_exclusivity_locks_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_exclusivity_locks_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_exclusivity_locks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          assessed_value: number | null
          business_phone: string | null
          business_status: string | null
          business_website: string | null
          cascade_count: number | null
          cascade_flag: boolean | null
          city: string | null
          co_owner: string | null
          contact_confidence: number | null
          contact_extracted_at: string | null
          contact_source: string | null
          contacted_at: string | null
          contractor_id: string
          created_at: string
          cross_trade_suggestions: Json | null
          email: string | null
          email2: string | null
          employer: string | null
          home_sqft: string | null
          id: string
          is_homeowner_intake: boolean | null
          job_stage: string | null
          last_enriched_at: string | null
          latitude: number | null
          license_number: string | null
          license_status: string | null
          longitude: number | null
          lot_sqft: string | null
          mailing_address: string | null
          naics_code: string | null
          notes: string | null
          occupation: string | null
          owner_first: string | null
          owner_last: string | null
          owner_name: string | null
          owner_occupied: boolean | null
          owner_since: string | null
          permit_description: string | null
          permit_history: Json | null
          permit_id: string
          permit_type: string | null
          permit_value: number | null
          phone: string | null
          phone2: string | null
          pipeline_value: number | null
          property_value: number | null
          score: number
          score_contact: number | null
          score_conversion: number | null
          score_demand: number | null
          score_engagement: number | null
          score_freshness: number | null
          score_model: string | null
          score_reasoning: string | null
          score_signals: Json | null
          score_value: number | null
          state: string | null
          status: Database["public"]["Enums"]["lead_status"]
          trade: string | null
          updated_at: string
          urgency: Database["public"]["Enums"]["lead_urgency"]
          won_at: string | null
          year_built: number | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          assessed_value?: number | null
          business_phone?: string | null
          business_status?: string | null
          business_website?: string | null
          cascade_count?: number | null
          cascade_flag?: boolean | null
          city?: string | null
          co_owner?: string | null
          contact_confidence?: number | null
          contact_extracted_at?: string | null
          contact_source?: string | null
          contacted_at?: string | null
          contractor_id: string
          created_at?: string
          cross_trade_suggestions?: Json | null
          email?: string | null
          email2?: string | null
          employer?: string | null
          home_sqft?: string | null
          id?: string
          is_homeowner_intake?: boolean | null
          job_stage?: string | null
          last_enriched_at?: string | null
          latitude?: number | null
          license_number?: string | null
          license_status?: string | null
          longitude?: number | null
          lot_sqft?: string | null
          mailing_address?: string | null
          naics_code?: string | null
          notes?: string | null
          occupation?: string | null
          owner_first?: string | null
          owner_last?: string | null
          owner_name?: string | null
          owner_occupied?: boolean | null
          owner_since?: string | null
          permit_description?: string | null
          permit_history?: Json | null
          permit_id: string
          permit_type?: string | null
          permit_value?: number | null
          phone?: string | null
          phone2?: string | null
          pipeline_value?: number | null
          property_value?: number | null
          score?: number
          score_contact?: number | null
          score_conversion?: number | null
          score_demand?: number | null
          score_engagement?: number | null
          score_freshness?: number | null
          score_model?: string | null
          score_reasoning?: string | null
          score_signals?: Json | null
          score_value?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          trade?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["lead_urgency"]
          won_at?: string | null
          year_built?: number | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          assessed_value?: number | null
          business_phone?: string | null
          business_status?: string | null
          business_website?: string | null
          cascade_count?: number | null
          cascade_flag?: boolean | null
          city?: string | null
          co_owner?: string | null
          contact_confidence?: number | null
          contact_extracted_at?: string | null
          contact_source?: string | null
          contacted_at?: string | null
          contractor_id?: string
          created_at?: string
          cross_trade_suggestions?: Json | null
          email?: string | null
          email2?: string | null
          employer?: string | null
          home_sqft?: string | null
          id?: string
          is_homeowner_intake?: boolean | null
          job_stage?: string | null
          last_enriched_at?: string | null
          latitude?: number | null
          license_number?: string | null
          license_status?: string | null
          longitude?: number | null
          lot_sqft?: string | null
          mailing_address?: string | null
          naics_code?: string | null
          notes?: string | null
          occupation?: string | null
          owner_first?: string | null
          owner_last?: string | null
          owner_name?: string | null
          owner_occupied?: boolean | null
          owner_since?: string | null
          permit_description?: string | null
          permit_history?: Json | null
          permit_id?: string
          permit_type?: string | null
          permit_value?: number | null
          phone?: string | null
          phone2?: string | null
          pipeline_value?: number | null
          property_value?: number | null
          score?: number
          score_contact?: number | null
          score_conversion?: number | null
          score_demand?: number | null
          score_engagement?: number | null
          score_freshness?: number | null
          score_model?: string | null
          score_reasoning?: string | null
          score_signals?: Json | null
          score_value?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          trade?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["lead_urgency"]
          won_at?: string | null
          year_built?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_permit_id_fkey"
            columns: ["permit_id"]
            isOneToOne: false
            referencedRelation: "permits"
            referencedColumns: ["id"]
          },
        ]
      }
      market_intel_zip: {
        Row: {
          as_of: string
          avg_value_90d: number
          created_at: string
          permit_count_90d: number
          permit_count_mom_delta_pct: number | null
          state: string | null
          top_applicants: Json
          top_trades: Json
          total_value_90d: number
          trending_down: Json
          trending_up: Json
          updated_at: string
          zip: string
        }
        Insert: {
          as_of?: string
          avg_value_90d?: number
          created_at?: string
          permit_count_90d?: number
          permit_count_mom_delta_pct?: number | null
          state?: string | null
          top_applicants?: Json
          top_trades?: Json
          total_value_90d?: number
          trending_down?: Json
          trending_up?: Json
          updated_at?: string
          zip: string
        }
        Update: {
          as_of?: string
          avg_value_90d?: number
          created_at?: string
          permit_count_90d?: number
          permit_count_mom_delta_pct?: number | null
          state?: string | null
          top_applicants?: Json
          top_trades?: Json
          total_value_90d?: number
          trending_down?: Json
          trending_up?: Json
          updated_at?: string
          zip?: string
        }
        Relationships: []
      }
      missed_call_events: {
        Row: {
          auto_reply_sent: boolean
          caller_number: string | null
          contractor_id: string
          created_at: string
          id: string
          matched_lead_id: string | null
          provider_message_id: string | null
          raw_webhook_json: Json | null
          received_at: string
          reply_text: string | null
        }
        Insert: {
          auto_reply_sent?: boolean
          caller_number?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          matched_lead_id?: string | null
          provider_message_id?: string | null
          raw_webhook_json?: Json | null
          received_at?: string
          reply_text?: string | null
        }
        Update: {
          auto_reply_sent?: boolean
          caller_number?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          matched_lead_id?: string | null
          provider_message_id?: string | null
          raw_webhook_json?: Json | null
          received_at?: string
          reply_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missed_call_events_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_call_events_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_call_events_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json | null
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_logs: {
        Row: {
          channel: string
          content: string | null
          contractor_id: string
          id: string
          lead_id: string | null
          opened_at: string | null
          recipient: string | null
          replied_at: string | null
          sent_at: string
          status: string
          subject: string | null
          template_name: string | null
        }
        Insert: {
          channel: string
          content?: string | null
          contractor_id: string
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          recipient?: string | null
          replied_at?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          template_name?: string | null
        }
        Update: {
          channel?: string
          content?: string | null
          contractor_id?: string
          id?: string
          lead_id?: string | null
          opened_at?: string | null
          recipient?: string | null
          replied_at?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_logs_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_logs_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_queue: {
        Row: {
          body: string
          bounce_reason: string | null
          bounced_at: string | null
          channel: string
          contractor_id: string
          created_at: string
          delivered_at: string | null
          external_id: string | null
          id: string
          lead_id: string
          opened_at: string | null
          recipient: string
          replied_at: string | null
          scheduled_for: string
          sent_at: string | null
          sequence_id: string | null
          status: string
          step_index: number
          subject: string | null
        }
        Insert: {
          body: string
          bounce_reason?: string | null
          bounced_at?: string | null
          channel: string
          contractor_id: string
          created_at?: string
          delivered_at?: string | null
          external_id?: string | null
          id?: string
          lead_id: string
          opened_at?: string | null
          recipient: string
          replied_at?: string | null
          scheduled_for: string
          sent_at?: string | null
          sequence_id?: string | null
          status?: string
          step_index?: number
          subject?: string | null
        }
        Update: {
          body?: string
          bounce_reason?: string | null
          bounced_at?: string | null
          channel?: string
          contractor_id?: string
          created_at?: string
          delivered_at?: string | null
          external_id?: string | null
          id?: string
          lead_id?: string
          opened_at?: string | null
          recipient?: string
          replied_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          sequence_id?: string | null
          status?: string
          step_index?: number
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_queue_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_queue_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_templates: {
        Row: {
          body: string
          channel: string
          contractor_id: string | null
          created_at: string | null
          id: string
          is_default: boolean
          is_library: boolean
          name: string
          stage: string | null
          subject: string | null
          trade: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string
          channel?: string
          contractor_id?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean
          is_library?: boolean
          name: string
          stage?: string | null
          subject?: string | null
          trade?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string
          channel?: string
          contractor_id?: string | null
          created_at?: string | null
          id?: string
          is_default?: boolean
          is_library?: boolean
          name?: string
          stage?: string | null
          subject?: string | null
          trade?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_templates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_templates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permit_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["permit_event_type"]
          id: string
          notes: string | null
          occurred_at: string
          permit_id: string
          raw_json: Json | null
          source: string | null
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["permit_event_type"]
          id?: string
          notes?: string | null
          occurred_at?: string
          permit_id: string
          raw_json?: Json | null
          source?: string | null
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["permit_event_type"]
          id?: string
          notes?: string | null
          occurred_at?: string
          permit_id?: string
          raw_json?: Json | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permit_events_permit_id_fkey"
            columns: ["permit_id"]
            isOneToOne: false
            referencedRelation: "permits"
            referencedColumns: ["id"]
          },
        ]
      }
      permit_source_zips: {
        Row: {
          created_at: string
          granularity: string
          source_key: string
          zip: string
        }
        Insert: {
          created_at?: string
          granularity?: string
          source_key: string
          zip: string
        }
        Update: {
          created_at?: string
          granularity?: string
          source_key?: string
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "permit_source_zips_source_key_fkey"
            columns: ["source_key"]
            isOneToOne: false
            referencedRelation: "permit_sources"
            referencedColumns: ["source_key"]
          },
        ]
      }
      permit_sources: {
        Row: {
          address_field: string | null
          auth: string
          city: string | null
          created_at: string
          date_field: string | null
          desc_field: string | null
          discovered_via: string | null
          enabled: boolean
          endpoint: string
          error_count: number
          field_mapping_status: string
          id: string
          id_field: string | null
          imported_at: string | null
          jurisdiction: string | null
          last_count: number | null
          last_scraped_at: string | null
          lat_field: string | null
          layer_index: number | null
          lng_field: string | null
          name: string
          notes: string | null
          priority: number
          source_key: string
          source_type: string
          state: string
          status_field: string | null
          type_field: string | null
          update_freq: string | null
          updated_at: string
          value_field: string | null
        }
        Insert: {
          address_field?: string | null
          auth?: string
          city?: string | null
          created_at?: string
          date_field?: string | null
          desc_field?: string | null
          discovered_via?: string | null
          enabled?: boolean
          endpoint: string
          error_count?: number
          field_mapping_status?: string
          id?: string
          id_field?: string | null
          imported_at?: string | null
          jurisdiction?: string | null
          last_count?: number | null
          last_scraped_at?: string | null
          lat_field?: string | null
          layer_index?: number | null
          lng_field?: string | null
          name: string
          notes?: string | null
          priority?: number
          source_key: string
          source_type: string
          state: string
          status_field?: string | null
          type_field?: string | null
          update_freq?: string | null
          updated_at?: string
          value_field?: string | null
        }
        Update: {
          address_field?: string | null
          auth?: string
          city?: string | null
          created_at?: string
          date_field?: string | null
          desc_field?: string | null
          discovered_via?: string | null
          enabled?: boolean
          endpoint?: string
          error_count?: number
          field_mapping_status?: string
          id?: string
          id_field?: string | null
          imported_at?: string | null
          jurisdiction?: string | null
          last_count?: number | null
          last_scraped_at?: string | null
          lat_field?: string | null
          layer_index?: number | null
          lng_field?: string | null
          name?: string
          notes?: string | null
          priority?: number
          source_key?: string
          source_type?: string
          state?: string
          status_field?: string | null
          type_field?: string | null
          update_freq?: string | null
          updated_at?: string
          value_field?: string | null
        }
        Relationships: []
      }
      permits: {
        Row: {
          actual_value: number | null
          address: string | null
          applicant_name: string | null
          applied_date: string | null
          approved_date: string | null
          city: string | null
          completed_date: string | null
          contact_confidence: number | null
          contact_extracted_at: string | null
          contact_source: string | null
          contractor_name: string | null
          created_at: string
          description: string | null
          estimated_value: number | null
          id: string
          issued_date: string | null
          latitude: number | null
          location: unknown
          longitude: number | null
          permit_number: string | null
          permit_type: Database["public"]["Enums"]["permit_type"]
          raw_json: Json | null
          scored_at: string | null
          source_city: string
          source_id: string
          source_type: string | null
          state: string | null
          status: Database["public"]["Enums"]["permit_status"]
          updated_at: string
          zip: string | null
        }
        Insert: {
          actual_value?: number | null
          address?: string | null
          applicant_name?: string | null
          applied_date?: string | null
          approved_date?: string | null
          city?: string | null
          completed_date?: string | null
          contact_confidence?: number | null
          contact_extracted_at?: string | null
          contact_source?: string | null
          contractor_name?: string | null
          created_at?: string
          description?: string | null
          estimated_value?: number | null
          id?: string
          issued_date?: string | null
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          permit_number?: string | null
          permit_type?: Database["public"]["Enums"]["permit_type"]
          raw_json?: Json | null
          scored_at?: string | null
          source_city: string
          source_id: string
          source_type?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["permit_status"]
          updated_at?: string
          zip?: string | null
        }
        Update: {
          actual_value?: number | null
          address?: string | null
          applicant_name?: string | null
          applied_date?: string | null
          approved_date?: string | null
          city?: string | null
          completed_date?: string | null
          contact_confidence?: number | null
          contact_extracted_at?: string | null
          contact_source?: string | null
          contractor_name?: string | null
          created_at?: string
          description?: string | null
          estimated_value?: number | null
          id?: string
          issued_date?: string | null
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          permit_number?: string | null
          permit_type?: Database["public"]["Enums"]["permit_type"]
          raw_json?: Json | null
          scored_at?: string | null
          source_city?: string
          source_id?: string
          source_type?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["permit_status"]
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      ppp_loans: {
        Row: {
          borrower_address: string | null
          borrower_city: string | null
          borrower_name: string
          borrower_state: string | null
          borrower_zip: string | null
          business_phone: string | null
          email: string | null
          employee_count: number | null
          forgiveness_status: string | null
          id: string
          loan_amount: number | null
          loan_date: string | null
          loan_id: string | null
          naics_code: string | null
          owner_address: string | null
          owner_first: string | null
          owner_last: string | null
          updated_at: string | null
        }
        Insert: {
          borrower_address?: string | null
          borrower_city?: string | null
          borrower_name: string
          borrower_state?: string | null
          borrower_zip?: string | null
          business_phone?: string | null
          email?: string | null
          employee_count?: number | null
          forgiveness_status?: string | null
          id?: string
          loan_amount?: number | null
          loan_date?: string | null
          loan_id?: string | null
          naics_code?: string | null
          owner_address?: string | null
          owner_first?: string | null
          owner_last?: string | null
          updated_at?: string | null
        }
        Update: {
          borrower_address?: string | null
          borrower_city?: string | null
          borrower_name?: string
          borrower_state?: string | null
          borrower_zip?: string | null
          business_phone?: string | null
          email?: string | null
          employee_count?: number | null
          forgiveness_status?: string | null
          id?: string
          loan_amount?: number | null
          loan_date?: string | null
          loan_id?: string | null
          naics_code?: string | null
          owner_address?: string | null
          owner_first?: string | null
          owner_last?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          avg_rating: number | null
          badge_background: boolean | null
          badge_insured: boolean | null
          badge_licensed: boolean | null
          bio: string | null
          capacity_prefs: Json | null
          city: string | null
          company_name: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          insurance_expiry: string | null
          jobs_completed: number | null
          last_compliance_check_at: string | null
          last_license_verified_at: string | null
          license_number: string | null
          license_state: string | null
          licensed_until: string | null
          notification_prefs: Json | null
          onboarding_completed: boolean
          outreach_auto_fire: Json | null
          pending_plan: string | null
          pending_plan_effective_at: string | null
          phone: string | null
          plan: Database["public"]["Enums"]["plan_type"]
          portfolio_photos: string[] | null
          profile_public: boolean | null
          referred_by: string | null
          response_time_h: number | null
          review_count: number | null
          review_links: Json | null
          role: string
          service_area: string[] | null
          specialties: string[] | null
          state: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trade: Database["public"]["Enums"]["trade_type"]
          trial_ends_at: string | null
          twilio_tracked_number: string | null
          updated_at: string
          verified_at: string | null
          years_experience: number | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          avg_rating?: number | null
          badge_background?: boolean | null
          badge_insured?: boolean | null
          badge_licensed?: boolean | null
          bio?: string | null
          capacity_prefs?: Json | null
          city?: string | null
          company_name?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          insurance_expiry?: string | null
          jobs_completed?: number | null
          last_compliance_check_at?: string | null
          last_license_verified_at?: string | null
          license_number?: string | null
          license_state?: string | null
          licensed_until?: string | null
          notification_prefs?: Json | null
          onboarding_completed?: boolean
          outreach_auto_fire?: Json | null
          pending_plan?: string | null
          pending_plan_effective_at?: string | null
          phone?: string | null
          plan?: Database["public"]["Enums"]["plan_type"]
          portfolio_photos?: string[] | null
          profile_public?: boolean | null
          referred_by?: string | null
          response_time_h?: number | null
          review_count?: number | null
          review_links?: Json | null
          role?: string
          service_area?: string[] | null
          specialties?: string[] | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trade?: Database["public"]["Enums"]["trade_type"]
          trial_ends_at?: string | null
          twilio_tracked_number?: string | null
          updated_at?: string
          verified_at?: string | null
          years_experience?: number | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          avg_rating?: number | null
          badge_background?: boolean | null
          badge_insured?: boolean | null
          badge_licensed?: boolean | null
          bio?: string | null
          capacity_prefs?: Json | null
          city?: string | null
          company_name?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          insurance_expiry?: string | null
          jobs_completed?: number | null
          last_compliance_check_at?: string | null
          last_license_verified_at?: string | null
          license_number?: string | null
          license_state?: string | null
          licensed_until?: string | null
          notification_prefs?: Json | null
          onboarding_completed?: boolean
          outreach_auto_fire?: Json | null
          pending_plan?: string | null
          pending_plan_effective_at?: string | null
          phone?: string | null
          plan?: Database["public"]["Enums"]["plan_type"]
          portfolio_photos?: string[] | null
          profile_public?: boolean | null
          referred_by?: string | null
          response_time_h?: number | null
          review_count?: number | null
          review_links?: Json | null
          role?: string
          service_area?: string[] | null
          specialties?: string[] | null
          state?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trade?: Database["public"]["Enums"]["trade_type"]
          trial_ends_at?: string | null
          twilio_tracked_number?: string | null
          updated_at?: string
          verified_at?: string | null
          years_experience?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      quotes: {
        Row: {
          contractor_id: string
          created_at: string
          decline_reason: string | null
          description: string | null
          expires_at: string | null
          financing_available: boolean
          homeowner_id: string | null
          id: string
          intake_id: string | null
          lead_id: string | null
          message: string | null
          monthly_payment: number | null
          requested_at: string
          responded_at: string | null
          scope_notes: string | null
          selected_tier: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          tier_best: Json | null
          tier_better: Json | null
          tier_good: Json | null
          trade: string
          updated_at: string
          viewed_at: string | null
          zip: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          decline_reason?: string | null
          description?: string | null
          expires_at?: string | null
          financing_available?: boolean
          homeowner_id?: string | null
          id?: string
          intake_id?: string | null
          lead_id?: string | null
          message?: string | null
          monthly_payment?: number | null
          requested_at?: string
          responded_at?: string | null
          scope_notes?: string | null
          selected_tier?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          tier_best?: Json | null
          tier_better?: Json | null
          tier_good?: Json | null
          trade: string
          updated_at?: string
          viewed_at?: string | null
          zip: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          decline_reason?: string | null
          description?: string | null
          expires_at?: string | null
          financing_available?: boolean
          homeowner_id?: string | null
          id?: string
          intake_id?: string | null
          lead_id?: string | null
          message?: string | null
          monthly_payment?: number | null
          requested_at?: string
          responded_at?: string | null
          scope_notes?: string | null
          selected_tier?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          tier_best?: Json | null
          tier_better?: Json | null
          tier_good?: Json | null
          trade?: string
          updated_at?: string
          viewed_at?: string | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_homeowner_id_fkey"
            columns: ["homeowner_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_homeowner_id_fkey"
            columns: ["homeowner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "homeowner_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          contractor_id: string
          created_at: string
          id: string
        }
        Insert: {
          code: string
          contractor_id: string
          created_at?: string
          id?: string
        }
        Update: {
          code?: string
          contractor_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: true
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_codes_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_credits: {
        Row: {
          applied_at: string
          id: string
          referee_id: string
          referrer_id: string
          stripe_coupon_id: string | null
          stripe_invoice_id: string
          updated_at: string
        }
        Insert: {
          applied_at?: string
          id?: string
          referee_id: string
          referrer_id: string
          stripe_coupon_id?: string | null
          stripe_invoice_id: string
          updated_at?: string
        }
        Update: {
          applied_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
          stripe_coupon_id?: string | null
          stripe_invoice_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_credits_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_credits_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_credits_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_credits_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          converted_at: string | null
          created_at: string
          id: string
          referred_email: string
          referred_name: string | null
          referred_user_id: string | null
          referrer_id: string
          reward_amount: number | null
          reward_issued: boolean
          reward_label: string | null
          status: Database["public"]["Enums"]["referral_status"]
          type: Database["public"]["Enums"]["referral_type"]
        }
        Insert: {
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_email: string
          referred_name?: string | null
          referred_user_id?: string | null
          referrer_id: string
          reward_amount?: number | null
          reward_issued?: boolean
          reward_label?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          type?: Database["public"]["Enums"]["referral_type"]
        }
        Update: {
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_email?: string
          referred_name?: string | null
          referred_user_id?: string | null
          referrer_id?: string
          reward_amount?: number | null
          reward_issued?: boolean
          reward_label?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          type?: Database["public"]["Enums"]["referral_type"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_requests: {
        Row: {
          channel: string
          completed_at: string | null
          contractor_id: string
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          expires_at: string
          id: string
          lead_id: string | null
          review_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["review_request_status"]
          token: string
        }
        Insert: {
          channel?: string
          completed_at?: string | null
          contractor_id: string
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          expires_at?: string
          id?: string
          lead_id?: string | null
          review_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["review_request_status"]
          token?: string
        }
        Update: {
          channel?: string
          completed_at?: string | null
          contractor_id?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          expires_at?: string
          id?: string
          lead_id?: string | null
          review_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["review_request_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_requests_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_responses: {
        Row: {
          body: string
          contractor_id: string
          created_at: string
          id: string
          review_id: string
        }
        Insert: {
          body: string
          contractor_id: string
          created_at?: string
          id?: string
          review_id: string
        }
        Update: {
          body?: string
          contractor_id?: string
          created_at?: string
          id?: string
          review_id?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          ai_response: string | null
          body: string | null
          contractor_id: string
          created_at: string
          id: string
          lead_id: string | null
          rating: number
          responded_at: string | null
          response_sent: boolean
          reviewer_email: string | null
          reviewer_name: string
          reviewer_phone: string | null
          sentiment: string | null
          source: string
          title: string | null
          trade: string | null
          verified: boolean
          zip: string | null
        }
        Insert: {
          ai_response?: string | null
          body?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          rating: number
          responded_at?: string | null
          response_sent?: boolean
          reviewer_email?: string | null
          reviewer_name: string
          reviewer_phone?: string | null
          sentiment?: string | null
          source?: string
          title?: string | null
          trade?: string | null
          verified?: boolean
          zip?: string | null
        }
        Update: {
          ai_response?: string | null
          body?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          rating?: number
          responded_at?: string | null
          response_sent?: boolean
          reviewer_email?: string | null
          reviewer_name?: string
          reviewer_phone?: string | null
          sentiment?: string | null
          source?: string
          title?: string | null
          trade?: string | null
          verified?: boolean
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      storm_events: {
        Row: {
          begin_date: string
          county: string | null
          created_at: string
          damage_crops: number | null
          damage_property: number | null
          deaths_direct: number | null
          end_date: string | null
          event_id: string
          event_type: string
          id: number
          injuries_direct: number | null
          latitude: number | null
          longitude: number | null
          magnitude: number | null
          narrative: string | null
          source: string | null
          state: string
          zip: string | null
        }
        Insert: {
          begin_date: string
          county?: string | null
          created_at?: string
          damage_crops?: number | null
          damage_property?: number | null
          deaths_direct?: number | null
          end_date?: string | null
          event_id: string
          event_type: string
          id?: never
          injuries_direct?: number | null
          latitude?: number | null
          longitude?: number | null
          magnitude?: number | null
          narrative?: string | null
          source?: string | null
          state: string
          zip?: string | null
        }
        Update: {
          begin_date?: string
          county?: string | null
          created_at?: string
          damage_crops?: number | null
          damage_property?: number | null
          deaths_direct?: number | null
          end_date?: string | null
          event_id?: string
          event_type?: string
          id?: never
          injuries_direct?: number | null
          latitude?: number | null
          longitude?: number | null
          magnitude?: number | null
          narrative?: string | null
          source?: string | null
          state?: string
          zip?: string | null
        }
        Relationships: []
      }
      territories: {
        Row: {
          claimed_at: string
          contractor_id: string
          created_at: string
          id: string
          released_at: string | null
          slot_number: number
          status: Database["public"]["Enums"]["territory_status"]
          updated_at: string
          zip: string
        }
        Insert: {
          claimed_at?: string
          contractor_id: string
          created_at?: string
          id?: string
          released_at?: string | null
          slot_number: number
          status?: Database["public"]["Enums"]["territory_status"]
          updated_at?: string
          zip: string
        }
        Update: {
          claimed_at?: string
          contractor_id?: string
          created_at?: string
          id?: string
          released_at?: string | null
          slot_number?: number
          status?: Database["public"]["Enums"]["territory_status"]
          updated_at?: string
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "territories_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territories_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      voter_fl: {
        Row: {
          county: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          middle_name: string | null
          name_suffix: string | null
          party: string | null
          phone: string | null
          registration_date: string | null
          residence_address: string | null
          residence_city: string | null
          residence_zip: string | null
          updated_at: string
          voter_id: string | null
        }
        Insert: {
          county?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name_suffix?: string | null
          party?: string | null
          phone?: string | null
          registration_date?: string | null
          residence_address?: string | null
          residence_city?: string | null
          residence_zip?: string | null
          updated_at?: string
          voter_id?: string | null
        }
        Update: {
          county?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name_suffix?: string | null
          party?: string | null
          phone?: string | null
          registration_date?: string | null
          residence_address?: string | null
          residence_city?: string | null
          residence_zip?: string | null
          updated_at?: string
          voter_id?: string | null
        }
        Relationships: []
      }
      voter_nc: {
        Row: {
          county: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          middle_name: string | null
          name_suffix: string | null
          party: string | null
          phone: string | null
          registration_date: string | null
          residence_address: string | null
          residence_city: string | null
          residence_zip: string | null
          updated_at: string
          voter_id: string | null
        }
        Insert: {
          county?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name_suffix?: string | null
          party?: string | null
          phone?: string | null
          registration_date?: string | null
          residence_address?: string | null
          residence_city?: string | null
          residence_zip?: string | null
          updated_at?: string
          voter_id?: string | null
        }
        Update: {
          county?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name_suffix?: string | null
          party?: string | null
          phone?: string | null
          registration_date?: string | null
          residence_address?: string | null
          residence_city?: string | null
          residence_zip?: string | null
          updated_at?: string
          voter_id?: string | null
        }
        Relationships: []
      }
      voter_oh: {
        Row: {
          county: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          middle_name: string | null
          name_suffix: string | null
          party: string | null
          phone: string | null
          registration_date: string | null
          residence_address: string | null
          residence_city: string | null
          residence_zip: string | null
          updated_at: string
          voter_id: string | null
        }
        Insert: {
          county?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name_suffix?: string | null
          party?: string | null
          phone?: string | null
          registration_date?: string | null
          residence_address?: string | null
          residence_city?: string | null
          residence_zip?: string | null
          updated_at?: string
          voter_id?: string | null
        }
        Update: {
          county?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          middle_name?: string | null
          name_suffix?: string | null
          party?: string | null
          phone?: string | null
          registration_date?: string | null
          residence_address?: string | null
          residence_city?: string | null
          residence_zip?: string | null
          updated_at?: string
          voter_id?: string | null
        }
        Relationships: []
      }
      webhook_idempotency: {
        Row: {
          event_id: string
          event_type: string | null
          processed_at: string
          provider: string
          raw_meta: Json | null
        }
        Insert: {
          event_id: string
          event_type?: string | null
          processed_at?: string
          provider: string
          raw_meta?: Json | null
        }
        Update: {
          event_id?: string
          event_type?: string | null
          processed_at?: string
          provider?: string
          raw_meta?: Json | null
        }
        Relationships: []
      }
      zip_demand_scores: {
        Row: {
          avg_project_value: number | null
          competition_level: string
          computed_at: string
          contractor_density: number
          demand_score: number
          permits_30d: number
          permits_trend_pct: number | null
          top_trade: string | null
          zip: string
        }
        Insert: {
          avg_project_value?: number | null
          competition_level?: string
          computed_at?: string
          contractor_density?: number
          demand_score?: number
          permits_30d?: number
          permits_trend_pct?: number | null
          top_trade?: string | null
          zip: string
        }
        Update: {
          avg_project_value?: number | null
          competition_level?: string
          computed_at?: string
          contractor_density?: number
          demand_score?: number
          permits_30d?: number
          permits_trend_pct?: number | null
          top_trade?: string | null
          zip?: string
        }
        Relationships: []
      }
      zip_reference: {
        Row: {
          city: string | null
          county: string | null
          state: string
          state_fips: string | null
          state_name: string | null
          zipcode: string
        }
        Insert: {
          city?: string | null
          county?: string | null
          state: string
          state_fips?: string | null
          state_name?: string | null
          zipcode: string
        }
        Update: {
          city?: string | null
          county?: string | null
          state?: string
          state_fips?: string | null
          state_name?: string | null
          zipcode?: string
        }
        Relationships: []
      }
      zip_waitlist: {
        Row: {
          contractor_id: string
          id: string
          joined_at: string
          position: number
          zip: string
        }
        Insert: {
          contractor_id: string
          id?: string
          joined_at?: string
          position: number
          zip: string
        }
        Update: {
          contractor_id?: string
          id?: string
          joined_at?: string
          position?: number
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "zip_waitlist_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractor_leaderboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zip_waitlist_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contractor_leaderboard: {
        Row: {
          avg_rating: number | null
          badge_background: boolean | null
          badge_insured: boolean | null
          badge_licensed: boolean | null
          close_rate: number | null
          company_name: string | null
          engagement_score: number | null
          id: string | null
          jobs_completed: number | null
          response_time_h: number | null
          revenue_30d: number | null
          review_count: number | null
          territory_zips: string[] | null
          trade: Database["public"]["Enums"]["trade_type"] | null
          verified_at: string | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      claim_territory: {
        Args: { p_contractor_id: string; p_zip: string }
        Returns: number
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      exec_sql: { Args: { sql: string }; Returns: undefined }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_or_create_referral_code: {
        Args: { p_contractor_id: string }
        Returns: string
      }
      get_zip_availability: { Args: { p_zip: string }; Returns: Json }
      gettransactionid: { Args: never; Returns: unknown }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      process_referral_signup: {
        Args: {
          p_new_user_email: string
          p_new_user_id: string
          p_new_user_role?: string
          p_referral_code: string
        }
        Returns: Json
      }
      refresh_contractor_stats: {
        Args: { p_contractor_id: string }
        Returns: undefined
      }
      refresh_market_intel_zip: {
        Args: never
        Returns: {
          zips_refreshed: number
        }[]
      }
      release_territory: {
        Args: { p_contractor_id: string; p_zip: string }
        Returns: undefined
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      exclusivity_release_reason: "expired" | "declined" | "won" | "forfeit"
      lead_status:
        | "new"
        | "contacted"
        | "quoted"
        | "proposal"
        | "won"
        | "lost"
        | "archived"
      lead_urgency: "hot" | "warm" | "cool" | "cold"
      milestone_status: "upcoming" | "in_progress" | "completed" | "skipped"
      notification_type:
        | "new_lead"
        | "territory_available"
        | "billing_alert"
        | "system"
        | "quote_request"
        | "quote_response"
        | "review_received"
        | "license_expiring"
        | "match"
        | "payment_failed"
        | "subscription_updated"
      permit_event_type:
        | "planning"
        | "applied"
        | "issued"
        | "rough_inspection"
        | "final_inspection"
        | "co_issued"
        | "expired"
        | "revoked"
      permit_status:
        | "submitted"
        | "approved"
        | "issued"
        | "final"
        | "expired"
        | "revoked"
      permit_type:
        | "residential"
        | "commercial"
        | "demolition"
        | "renovation"
        | "new_construction"
        | "addition"
        | "repair"
        | "other"
      plan_type: "free" | "founder" | "starter" | "pro" | "enterprise"
      quote_status:
        | "requested"
        | "draft"
        | "sent"
        | "viewed"
        | "accepted"
        | "declined"
        | "expired"
      referral_status: "invited" | "signed_up" | "converted"
      referral_type: "contractor" | "homeowner"
      review_request_status: "pending" | "sent" | "completed" | "expired"
      territory_status: "active" | "released" | "waitlisted"
      trade_type:
        | "general"
        | "roofing"
        | "plumbing"
        | "electrical"
        | "hvac"
        | "solar"
        | "landscaping"
        | "painting"
        | "concrete"
        | "other"
      user_role: "contractor" | "homeowner"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      exclusivity_release_reason: ["expired", "declined", "won", "forfeit"],
      lead_status: [
        "new",
        "contacted",
        "quoted",
        "proposal",
        "won",
        "lost",
        "archived",
      ],
      lead_urgency: ["hot", "warm", "cool", "cold"],
      milestone_status: ["upcoming", "in_progress", "completed", "skipped"],
      notification_type: [
        "new_lead",
        "territory_available",
        "billing_alert",
        "system",
        "quote_request",
        "quote_response",
        "review_received",
        "license_expiring",
        "match",
        "payment_failed",
        "subscription_updated",
      ],
      permit_event_type: [
        "planning",
        "applied",
        "issued",
        "rough_inspection",
        "final_inspection",
        "co_issued",
        "expired",
        "revoked",
      ],
      permit_status: [
        "submitted",
        "approved",
        "issued",
        "final",
        "expired",
        "revoked",
      ],
      permit_type: [
        "residential",
        "commercial",
        "demolition",
        "renovation",
        "new_construction",
        "addition",
        "repair",
        "other",
      ],
      plan_type: ["free", "founder", "starter", "pro", "enterprise"],
      quote_status: [
        "requested",
        "draft",
        "sent",
        "viewed",
        "accepted",
        "declined",
        "expired",
      ],
      referral_status: ["invited", "signed_up", "converted"],
      referral_type: ["contractor", "homeowner"],
      review_request_status: ["pending", "sent", "completed", "expired"],
      territory_status: ["active", "released", "waitlisted"],
      trade_type: [
        "general",
        "roofing",
        "plumbing",
        "electrical",
        "hvac",
        "solar",
        "landscaping",
        "painting",
        "concrete",
        "other",
      ],
      user_role: ["contractor", "homeowner"],
    },
  },
} as const
