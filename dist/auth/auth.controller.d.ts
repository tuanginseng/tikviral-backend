import { AuthService } from './auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    adminLogin(dto: AdminLoginDto): Promise<{
        success: boolean;
        userId: any;
        admin_token: string;
    }>;
}
