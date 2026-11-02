#define _GNU_SOURCE
#include <signal.h>
#include <sys/mman.h>
#include <ucontext.h>
#include <unistd.h>
#include <stdio.h>

/* Disposable host diagnostic: no network, app state or canister calls. */
static void *page;
static size_t page_size;
static volatile sig_atomic_t faults;
static volatile sig_atomic_t write_fault;
static void recover_write(int signal_number, siginfo_t *info, void *context) {
    (void)signal_number;
    if (++faults != 1 || info->si_addr != page) _exit(70);
    ucontext_t *u = context;
    write_fault = (u->uc_mcontext.gregs[REG_ERR] & 2) != 0;
    if (mprotect(page, page_size, PROT_READ | PROT_WRITE) != 0) _exit(71);
}
int main(void) {
    long size = sysconf(_SC_PAGESIZE);
    if (size <= 0) return 72;
    page_size = (size_t)size;
    page = mmap(NULL, page_size, PROT_READ | PROT_WRITE,
                MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (page == MAP_FAILED) return 73;
    struct sigaction action = {0};
    action.sa_sigaction = recover_write;
    action.sa_flags = SA_SIGINFO;
    if (sigemptyset(&action.sa_mask) || sigaction(SIGSEGV, &action, NULL)) return 74;
    *(volatile unsigned char *)page = 1;
    if (mprotect(page, page_size, PROT_READ)) return 75;
    *(volatile unsigned char *)page = 2;
    int recovered = *(volatile unsigned char *)page == 2 && faults == 1;
    printf("{\"faults\":%d,\"writeBit\":%d,\"recovered\":%s}\n",
           (int)faults, (int)write_fault, recovered ? "true" : "false");
    if (munmap(page, page_size)) return 76;
    return recovered ? 0 : 77;
}