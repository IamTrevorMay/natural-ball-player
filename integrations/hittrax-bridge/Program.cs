// HitTrax Bridge — NBP Portal integration (#48)
// ---------------------------------------------------------------------------
// Windows console app that subscribes to the HitTrax Public Real-time Data
// Access queue (Azure Service Bus, behind HitTrax's C#/.NET SDK) and, for every
// message received, writes the raw JSON body to disk.
//
// This is the SPIKE / capture build. Its whole job right now is to prove the
// connection works and let us collect REAL Play / Session / User payloads so the
// Supabase schema can be built to match live data (not just the doc's field
// list). A later revision swaps the FileSink for an HttpSink that POSTs each
// message to the Supabase `hittrax-ingest` edge function.
//
// The queue is durable: it buffers every unit's data in the HitTrax cloud from
// the first successful connect onward, even while this app is off. So you can
// start it, take swings later, and the messages will be waiting.
//
// Credentials come from environment variables (preferred — keeps secrets out of
// source & shell history) or, failing that, command-line args in the same order
// as HitTrax's RealtimeTest.exe:  URL apiID apiKey SID
//
//   Env:  HITTRAX_URL  HITTRAX_APIID  HITTRAX_APIKEY  HITTRAX_SID
//
// Output: one file per message under ./captured/
//   <utc-timestamp>__<ObjectType>__owner-<Owner>.json
// ---------------------------------------------------------------------------

using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace HitTraxBridge
{
    internal static class Program
    {
        // The SDK's entry object. Namespace/type per the HitTrax Developers Guide v1.0.
        private static readonly HitTraxPublicRealtimeDataAccessSDK.RealtimeDataAccess RtSdk =
            new HitTraxPublicRealtimeDataAccessSDK.RealtimeDataAccess();

        private static string _captureDir;
        private static long _count;

        private static void Main(string[] args)
        {
            // ---- Resolve credentials: env vars first, then positional args. ----
            var url = Env("HITTRAX_URL") ?? Arg(args, 0);
            var apiId = Env("HITTRAX_APIID") ?? Arg(args, 1);
            var apiKey = Env("HITTRAX_APIKEY") ?? Arg(args, 2);
            var sidStr = Env("HITTRAX_SID") ?? Arg(args, 3);

            if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(apiId) ||
                string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(sidStr))
            {
                Console.WriteLine("Missing credentials.");
                Console.WriteLine("Set env vars HITTRAX_URL / HITTRAX_APIID / HITTRAX_APIKEY / HITTRAX_SID,");
                Console.WriteLine("or pass them as args:  HitTraxBridge.exe <URL> <apiID> <apiKey> <SID>");
                return;
            }

            if (!int.TryParse(sidStr, out var sid))
            {
                Console.WriteLine("SID must be an integer. Got: " + sidStr);
                return;
            }

            // ---- Prepare the capture folder. ----
            _captureDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "captured");
            Directory.CreateDirectory(_captureDir);
            Console.WriteLine("Capturing messages to: " + _captureDir);

            // ---- Connect to the HitTrax cloud subscription. ----
            Console.WriteLine("Connecting to HitTrax cloud...");
            string response;
            try
            {
                response = RtSdk.InitializeSubscriptionClient(url, apiId, apiKey, sid);
            }
            catch (Exception ex)
            {
                Console.WriteLine("InitializeSubscriptionClient threw: " + ex.Message);
                return;
            }

            if (response != "Success")
            {
                Console.WriteLine("Failed to create a valid cloud connection: " + response);
                return;
            }
            Console.WriteLine("Connected. Waiting for messages — take some swings at the cage.");
            Console.WriteLine("Press any key to stop.\n");

            // ---- Register the pump. The SDK calls our handler for each message. ----
            RtSdk.RegisterOnMessageHandlerAndReceiveMessages(ProcessMessageAsync, ExceptionHandler);

            Console.ReadKey();
            Console.WriteLine("\nStopped. Captured " + _count + " message(s) this run.");
        }

        // Called by the SDK for every message delivered off the queue.
        private static Task ProcessMessageAsync(Microsoft.Azure.ServiceBus.Message message, CancellationToken token)
        {
            try
            {
                var owner = PropOrDefault(message, "Owner", "unknown");
                var objectType = PropOrDefault(message, "ObjectType", "Unknown");

                // The body is already JSON text (the object's data). Store it verbatim.
                var body = message.Body ?? Array.Empty<byte>();
                var json = Encoding.ASCII.GetString(body);

                var stamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff");
                var fileName = $"{stamp}__{Safe(objectType)}__owner-{Safe(owner)}.json";
                File.WriteAllBytes(Path.Combine(_captureDir, fileName), body);

                var n = Interlocked.Increment(ref _count);
                var preview = json.Length > 160 ? json.Substring(0, 160) + "…" : json;
                Console.WriteLine($"[{n}] {objectType} from unit {owner} — {body.Length} bytes");
                Console.WriteLine("     " + preview.Replace('\n', ' ').Replace('\r', ' '));
            }
            catch (Exception ex)
            {
                // Never throw out of the handler during the spike — just log and move on.
                Console.WriteLine("Handler error: " + ex.Message);
            }

            // The SDK's message pump auto-completes messages. If a future build sets
            // AutoComplete=false, call the SDK's completion method here instead.
            return Task.CompletedTask;
        }

        private static Task ExceptionHandler(Microsoft.Azure.ServiceBus.ExceptionReceivedEventArgs e)
        {
            Console.WriteLine("Message-pump exception: " + e.Exception.Message);
            var ctx = e.ExceptionReceivedContext;
            if (ctx != null)
            {
                Console.WriteLine($"  endpoint={ctx.Endpoint} entity={ctx.EntityPath} action={ctx.Action}");
            }
            return Task.CompletedTask;
        }

        // ---- helpers ----
        private static string Env(string name)
        {
            var v = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        }

        private static string Arg(string[] args, int i) => (args != null && args.Length > i) ? args[i] : null;

        private static string PropOrDefault(Microsoft.Azure.ServiceBus.Message m, string key, string fallback)
        {
            try
            {
                if (m.UserProperties != null && m.UserProperties.TryGetValue(key, out var val) && val != null)
                    return val.ToString();
            }
            catch { /* ignore */ }
            return fallback;
        }

        private static string Safe(string s)
        {
            if (string.IsNullOrEmpty(s)) return "na";
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '-');
            return s;
        }
    }
}
