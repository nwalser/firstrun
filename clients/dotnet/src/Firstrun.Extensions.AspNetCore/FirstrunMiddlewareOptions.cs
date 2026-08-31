using System;
using Microsoft.AspNetCore.Http;

namespace Firstrun
{
    /// <summary>
    /// What the request middleware is allowed to know: four delegates you write, and
    /// nothing it works out for itself.
    /// </summary>
    /// <remarks>
    /// Every one of these is a function rather than a setting because the answer is a
    /// property of one request and only your code knows where it lives. This library
    /// reads no cookie, no header, no IP and no principal on its own initiative, and it
    /// joins nothing across surfaces: what these return is the whole of what it knows.
    /// </remarks>
    public sealed class FirstrunMiddlewareOptions
    {
        /// <summary>
        /// <b>Required.</b> The anonymous id for one request. Return null to leave the
        /// request unrecorded.
        /// </summary>
        /// <remarks>
        /// On a server the anonymous id belongs to the caller, not to the machine: a
        /// visitor cookie, a device id your app already issues, the connection id as a
        /// last resort. Whatever you return is used verbatim, and nothing is invented,
        /// derived, looked up or guessed when you do not.
        /// <para>
        /// Returning null (or throwing) means the request is not recorded at all, rather
        /// than being filed under the client's own process-wide id. That fallback exists
        /// for a desktop app where the process is the install; on a server it would
        /// report every unattributed request as one install, and one install with a
        /// million page views is a worse answer than an honest gap.
        /// </para>
        /// <para>
        /// Leaving this unset disables the middleware entirely: see
        /// <see cref="FirstrunApplicationBuilderExtensions.UseFirstrun"/>.
        /// </para>
        /// </remarks>
        public Func<HttpContext, string?>? DeviceId { get; set; }

        /// <summary>
        /// Optional. Your own user id for one request, or null while it is anonymous.
        /// </summary>
        /// <remarks>
        /// The string you pass here is the only way a user id ever reaches an entry:
        /// <c>user.id</c> is never inferred from a cookie, a header or a claim on this
        /// library's initiative, and two surfaces reporting the same person are two
        /// uniques unless you name them the same thing yourself.
        /// <para>
        /// Called once, when the request arrives, because that is when the scope has to
        /// open for the handlers inside it. If you read
        /// <see cref="HttpContext.User"/> here, register the middleware after
        /// <c>UseAuthentication</c> or the principal will not be populated yet.
        /// </para>
        /// <para>
        /// Throwing is read as null: the request is recorded anonymously rather than not
        /// at all, because this field was optional to begin with and one broken delegate
        /// should not empty a request board.
        /// </para>
        /// </remarks>
        public Func<HttpContext, string?>? UserId { get; set; }

        /// <summary>
        /// Optional. The session this request belongs to, or null when you do not track
        /// one.
        /// </summary>
        /// <remarks>
        /// A session is a stretch of activity by one caller, and on a server only you know
        /// where it starts and stops: a signed session cookie, a connection id for a
        /// socket, a correlation id your gateway already issues. Return it here and every
        /// entry inside the request carries it, including the ones your own code records.
        /// <para>
        /// <b>Leave it unset and <c>session.id</c> is simply absent</b>, on this
        /// middleware's entry and on yours. It is not filled in with anything: a server
        /// process is not a sitting, so the client's own id would be one value shared by
        /// every caller the box has ever served, and
        /// <c>count(distinct session.id)</c> would count restarts. Absent is a gap somebody
        /// can fill; invented is a gap that looks answered. (<c>AddFirstrunServer</c> turns
        /// the process-wide id off for you; see
        /// <see cref="FirstrunOptions.SessionPerProcess"/> if you wire the client by hand.)
        /// </para>
        /// <para>
        /// Throwing is read as null, like <see cref="UserId"/>: the request is recorded
        /// without a session rather than not at all.
        /// </para>
        /// </remarks>
        public Func<HttpContext, string?>? SessionId { get; set; }

        /// <summary>
        /// Optional. Return true for a request firstrun should stay out of completely.
        /// </summary>
        /// <remarks>
        /// Health checks, readiness probes, a metrics scrape: traffic that is real and
        /// tells you nothing, and that would otherwise be most of the rows on the board.
        /// <para>
        /// An ignored request gets no entry <i>and</i> no ambient identity, and the three
        /// delegates above are not called for it. That is deliberate: a probe hit sixty
        /// times a minute should not be running your cookie lookup so that nothing can be
        /// done with the answer. If you want the scope without the entry, push it
        /// yourself with <see cref="FirstrunContext.Push"/> and leave this middleware off
        /// that branch of the pipeline.
        /// </para>
        /// <para>
        /// A predicate that throws is read as false. We cannot know what you meant, and
        /// recording a request you wanted excluded costs a filter on a board, while not
        /// recording it costs data that cannot be resent.
        /// </para>
        /// </remarks>
        public Func<HttpContext, bool>? Ignore { get; set; }
    }
}
