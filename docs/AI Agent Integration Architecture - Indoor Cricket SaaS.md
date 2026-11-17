# **AI Agent Integration Architecture & Implementation Plan**

## **Technical & Business Specification for Indoor Cricket Arena SaaS Platform**

# **1\. AI Agent Capabilities (Functional Plan)**

The AI Agent acts as an automated operational layer for venue managers and a seamless conversational assistant for players. Below are the four core functional pillars:

## **Automated Core Capabilities**

| Capability Module | Target Channels | Key Technical Functionalities | Business Value |
| :---- | :---- | :---- | :---- |
| **WhatsApp & Call Automation** | WhatsApp Business API, Voice Gateway | Multi-turn Natural Language Understanding (NLU) to extract dates, time ranges, duration, and lane specifications (e.g., Turf Net vs. Automated Bowling Machine). Integrates real-time slot validation. | Converts high-intent inbound chat traffic directly into confirmed bookings without staff intervention. |
| **Automated Support (FAQ)** | Web Widget, WhatsApp | Semantic search over venue-specific Knowledge Bases (pricing tiers, gear rentals, parking, cancellation rules, peak hours). | Reduces manual administrative queries by an estimated 70%. |
| **Smart Rescheduling** | WhatsApp, Web Widget | Intent classification for cancellations or change requests; triggers real-time availability scans and offers top 3 alternative slots. | Minimizes revenue loss from cancellations by retaining bookings within the same calendar week. |
| **Admin Insights & Dynamic Pricing** | Staff Admin Dashboard | Analyzes booking density patterns, weather API feeds, and historical usage to suggest off-peak discounts or peak surcharges. | Maximizes yield per court hour via data-driven dynamic pricing algorithms. |

## **Operational Workflow Example: Conversational Booking Flow**

* **Step 1 (Intent Detection):** Customer texts on WhatsApp: *"Looking for a turf net tomorrow after 6 PM for 2 hours."*  
* **Step 2 (Slot Querying):** AI extracts parameters (`laneType: TURF_NET`, `date: 2024-10-25`, `timeRange: 18:00-22:00`, `duration: 120min`). Backend runs an optimized PostgreSQL query to find non-overlapping slots.  
* **Step 3 (Proposal & Checkout):** AI returns two options with pre-filled checkout payment links. Upon successful payment callback via webhook, the reservation is locked.

# **2\. UI / UX Integration Plan**

## **Customer Facing (Web/Next.js & WhatsApp)**

* **Embedded Next.js Widget:** Floating, accessible UI component powered by `@tanstack/react-query` and WebSocket connection for real-time streaming responses. Features rich media UI cards for court selection directly within the chat window.  
* **WhatsApp Native Experience:** Quick-reply interactive buttons and list messages used wherever possible to constrain user inputs (e.g., selecting time slots or court types) alongside standard natural language input.

## **Staff / Admin Dashboard (Next.js)**

* **AI Co-Pilot Sidebar:** Persistent slide-out drawer on the admin panel providing real-time operational notifications and suggested actions (e.g., *"3 WhatsApp leads are waiting for manual confirmation due to custom payment requests"*).  
* **Live Sentiment & Priority Queue:** Incoming chats flagged with negative sentiment or high booking value are prioritized at the top of the queue.

## **Human Handoff UX Architecture**

| Handoff Trigger | System Action | Visual UI Indicator |
| :---- | :---- | :---- |
| **Low AI Confidence (\< 75%)** | AI sets `handoffStatus = PENDING`, notifies online staff via WebSockets. | Amber badge: **"AI Needs Assistance"** |
| **Customer Request ("Agent")** | Immediate transfer, AI pauses auto-responses for that session ID. | Blue badge: **"Transferred to Staff"** |
| **Active Staff Takeover** | Locks input on AI side, transfers write authority to current admin session. | Green banner: **"Handled by Person"** |

*To prevent overlapping responses, when a human agent types in the admin chat interface, a lock is acquired in Redis (`lock:chat:{sessionId}`) disabling the AI module for 15 minutes of user inactivity.*

# **3\. Database Architecture (Prisma & PostgreSQL)**

The database extensions introduce tracking for conversational state, model metadata on bookings, and per-tenant dynamic prompt configuration. Note that `isAiGenerated` defaults to `false` and `conversationId` is nullable in Phase 1 (MVP) so human bookings work out-of-the-box without schema rewrites in Phase 2\.

```
// Prisma Schema Extensions for AI Integration

enum ChannelType {
  WHATSAPP
  WEB_WIDGET
  VOICE
}

enum ResolutionStatus {
  AUTO_COMPLETED
  HANDOFF_REQUIRED
  HANDOFF_RESOLVED
  ABANDONED
}

model AiConversationLog {
  id               String           @id @default(uuid())
  tenantId         String
  customerPhone    String?
  sessionId        String           @unique
  channel          ChannelType
  rawTranscript    Json             // Array of { sender: string, text: string, timestamp: DateTime }
  extractedIntent  String?
  confidenceScore  Float
  resolutionStatus ResolutionStatus @default(AUTO_COMPLETED)
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  @@index([tenantId, createdAt])
  @@index([sessionId])
}

model AiSystemPrompts {
  id             String   @id @default(uuid())
  tenantId       String   @unique
  systemPrompt   String   @db.Text
  temperature    Float    @default(0.3)
  rules          String[] // Custom business constraints (e.g., "No discounts on Fridays")
  updatedBy      String
  updatedAt      DateTime @updatedAt
}

// Updated Booking model with AI audit fields
model Booking {
  id                String   @id @default(uuid())
  tenantId          String
  userId            String
  slotId            String
  amountPaid        Float
  
  // AI Metrics
  isAiGenerated     Boolean  @default(false)
  aiConfidenceScore Float?
  conversationId    String?
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

# **4\. Technical Stack & Implementation (NestJS \+ Next.js)**

## **Architecture Overview**

```
 [ Customer (WhatsApp / Web) ] 
              │
              ▼
   [ Next.js / WhatsApp API ]
              │
              ▼ (REST / WebSockets)
   [ NestJS Backend Engine ] ──────► [ Gemini API / LLM ]
              │
              ├─► [ AI Service Layer (Intent & Extraction) ]
              ├─► [ Booking Module (Availability Queries) ]
              │
              ▼
   [ Prisma ORM ] ──────► [ PostgreSQL Database ]
```

## **Module Responsibilities**

* **Frontend (Next.js 14 App Router):** Renders chat components, exposes admin co-pilot drawer, manages real-time socket connections to the backend, and handles admin prompt modification interfaces.  
* **Backend (NestJS Services):**  
  * `WhatsAppWebhookController`: Ingests incoming payload events, validates signatures, forwards text payloads to processing queue.  
  * `AiAgentService`: Interfaces with Gemini API using dynamic schema definitions (Function Calling / Structured Outputs) to ensure strict response JSON formatting.  
  * `AvailabilityService`: Implements optimized PostgreSQL queries using range indexes (`tsrange`) to calculate real-time slot availability without race conditions.

## **Availability Query Strategy**

To avoid double bookings during concurrent AI interactions, slot checking utilizes PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) inside Prisma transactions during the final booking lock phase.

# **5\. Maintenance & Future-Proofing Strategy**

## **Modular AI Service Design**

The core backend abstracts model providers via an interface strategy. If the system needs to migrate or update base models, only the adapter implementation needs modification:

```
export interface IAiProvider {
  generateStructuredResponse(
    prompt: string, 
    context: ConversationContext,
    tools: ToolDefinition[]
  ): Promise<AiAgentResponse>;
}
```

## **Prompt Engineering Governance**

* **Tenant Isolation:** Venue managers can adjust baseline rules via the Admin Dashboard UI. Prompts are assembled dynamically at runtime: `Final Prompt = System Master Template + Tenant Custom Rules + Context Metadata`.  
* **Version Control:** All prompt updates trigger an entry in `AiSystemPromptsHistory` to allow instant rollback if conversational completion accuracy degrades.  
* **Automated Guardrails:** Input and output validation layers prevent prompt injection attacks and block hallucinated discounts by validating final prices against the database pricing matrix prior to presenting options to customers.

# **6\. Phased Rollout & Implementation Roadmap**

## **Phase 1: Core MVP (Human-Led Booking & Operations System)**

* **Objective:** Replace manual paper logbooks and fragmented notes with a centralized, real-time web system managed by human agents and staff, establishing the core SaaS foundation before introducing AI complexity.  
* **Core Scope:**  
  * **Multi-Lane Slot Grid & Calendar (Next.js \+ NestJS):** Real-time availability matrix for Turf Nets and Bowling Machine lanes with Peak/Off-Peak pricing and anti-double-booking database locks.  
  * **Human-Assisted & Direct Web Booking:** Staff UI for human agents to log bookings received via WhatsApp/Phone calls, plus a direct self-service web booking page for customers.  
  * **Lead Attribution & Audit Trail:** Mandatory capture of Lead Source (WhatsApp, Call, Walk-in, Web), Lead Owner (the human sales agent who closed the lead), Booking Creator (staff member who entered it), and Player Headcount.  
  * **Payment Priority & Hold Engine:** Full payment, advance deposit, and unpaid tentative holds with automated hold-expiry timers.  
  * **Policies, Roster & RBAC:** Tiered cancellation fees, rescheduling tariff adjustments, staff shift scheduling, and Admin-controlled Role-Based Access Control (RBAC).  
  * **AI-Ready Database Schema:** Deploying the Prisma schema with future-ready fields (`isAiGenerated` defaulting to `false`, `conversationId` nullable) so Phase 2 requires zero breaking database migrations.

## **Phase 2: WhatsApp Automation & AI Agent Integration**

* **Objective:** Connect the WhatsApp Business API and deploy the conversational AI Agent to automate inbound bookings, customer support, and smart rescheduling on top of the proven Phase 1 engine.  
* **Core Scope:**  
  * **WhatsApp Business API Webhook (NestJS):** Automated two-way messaging, instant booking confirmations, QR gate passes, and payment links.  
  * **Conversational AI Booking Agent:** NLP intent extraction (date, time, duration, lane type) connected directly to the Phase 1 availability and booking services.  
  * **Automated FAQ & Smart Rescheduling:** 24/7 AI responses for pricing/policies and automated alternative slot proposals upon cancellation requests.  
  * **Admin AI Co-Pilot & Human Handoff:** Live chat takeover UI in Next.js with Redis session locking so human agents seamlessly step in whenever AI confidence drops below 75% or a customer requests a human.  
  * **Dynamic Pricing & Last-Minute Fill:** AI-assisted off-peak discount suggestions and automated WhatsApp flash alerts for last-minute canceled peak slots.